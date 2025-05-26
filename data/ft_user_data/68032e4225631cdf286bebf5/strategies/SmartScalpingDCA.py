# -- coding: utf-8 --
# SmartScalpingDCA.py (or BestScalpingDCA.py - ensure filename matches what you intend to use)

from freqtrade.strategy import IStrategy, IntParameter, DecimalParameter
from freqtrade.persistence import Trade
import talib.abstract as ta
import pandas as pd
# import numpy as np # Not strictly used in this version, can be removed if not needed
from datetime import datetime
from typing import Optional # Crucial for type hints
import logging

logger = logging.getLogger(__name__)

# Ensure the CLASS NAME here matches what is in your config.json -> "strategy": "THIS_NAME"
class SmartScalpingDCA(IStrategy):
    """
    Scalping strategy with EMA, SuperTrend, RSI for entry.
    Exits via ROI, stoploss, or ATR-based custom trailing stop.
    Includes DCA capabilities.
    Hyperopt-ready for key parameters.
    """

    ####################################################
    # STRATEGY DEFAULTS & CONFIGURATION
    ####################################################
    # These are defaults. They can be overridden by your config.json.
    timeframe = '15m' # Default timeframe
    startup_candle_count: int = 50 # How many candles to load on startup
    process_only_new_candles = True # Recommended for live trading

    # Core strategy features
    use_custom_stoploss = True       # Use the custom_stoploss method
    position_adjustment_enable = True # Enable DCA (adjust_trade_position method)

    # Default ROI table (can be overridden in config.json)
    minimal_roi = {
        "0": 0.05,    # Target 5% profit immediately
        "30": 0.03,   # Target 3% after 30 mins
        "60": 0.01    # Target 1% after 60 mins
    }

    # Default stoploss (can be overridden by custom_stoploss or config.json)
    stoploss = -0.02  # Default 2% hard stoploss

    # Default Trailing Stoploss configuration
    # These can also be overridden by config.json if present there.
    trailing_stop = True
    trailing_only_offset_is_reached = True # Only trail if profit offset is reached
    trailing_stop_positive_offset = 0.02  # Trail only when profit is > 0.5% (THIS IS THE KEY FIX)
                                           # Must be > 0 if trailing_only_offset_is_reached is True.
    trailing_stop_positive = 0.01  
    # Hyperoptable Parameters (these define search spaces for optimization)
    # Entry parameters
    st_period = IntParameter(low=7, high=21, default=11, space="buy", optimize=True)
    st_multiplier = DecimalParameter(low=2.0, high=4.0, default=3.0, decimals=1, space="buy", optimize=True)
    rsi_low = IntParameter(low=20, high=40, default=30, space="buy", optimize=True)

    # Exit/Stoploss parameters (used in custom_stoploss)
    atr_mult = DecimalParameter(low=1.5, high=4.0, default=2.5, decimals=1, space="sell", optimize=True)

    # DCA (Position Adjustment) parameters
    dca_threshold = DecimalParameter(low=-0.05, high=-0.02, default=-0.035, decimals=3, space="buy", optimize=True)
    dca_max_entries = IntParameter(low=1, high=3, default=2, space="buy", optimize=True) # Max number of DCA entries (e.g., 2 means initial + 2 DCAs = 3 total entries)

    ####################################################
    # INDICATORS
    ####################################################
    def populate_indicators(self, df: pd.DataFrame, metadata: dict) -> pd.DataFrame:
        # EMA
        df['ema20'] = ta.EMA(df['close'], timeperiod=20)
        df['ema50'] = ta.EMA(df['close'], timeperiod=50)

        # RSI
        df['rsi'] = ta.RSI(df['close'], timeperiod=14)

        # SuperTrend
        # Ensure you use .value when accessing hyperopt parameters
        st = ta.SUPERTREND(df['high'], df['low'], df['close'],
                           period=self.st_period.value,
                           multiplier=self.st_multiplier.value)
        # The column name from ta.SUPERTREND includes period and multiplier
        df['super_trend'] = st[f'SUPERT_{self.st_period.value}_{self.st_multiplier.value:.1f}']

        # ATR (Average True Range) for volatility, used in custom_stoploss
        df['atr'] = ta.ATR(df['high'], df['low'], df['close'], timeperiod=14) # Default ATR period
        return df

    ####################################################
    # ENTRY SIGNAL LOGIC
    ####################################################
    def populate_entry_trend(self, df: pd.DataFrame, metadata: dict) -> pd.DataFrame:
        df['enter_long'] = 0
        # This strategy only defines long entries. No 'enter_short' signals.

        # Ensure 'super_trend' column exists from populate_indicators
        if 'super_trend' not in df.columns:
            logger.warning(f"Pair {metadata['pair']}: 'super_trend' column not found in dataframe for entry. Check populate_indicators.")
            return df # Return df early if essential indicator is missing

        # Entry conditions for long
        enter_long_conditions = [
            (df['close'] > df['ema20']),          # Price is above the shorter EMA
            (df['ema20'] > df['ema50']),          # Shorter EMA is above longer EMA (uptrend confirmation)
            (df['super_trend'] < df['close']),    # SuperTrend indicates bullish (ST line is below price)
            (df['rsi'] < self.rsi_low.value)      # RSI is below the configured low threshold (e.g., 30)
        ]

        # Combine all conditions: all must be true
        if enter_long_conditions:
            df.loc[
                pd.concat(enter_long_conditions, axis=1).all(axis=1),
                'enter_long'
            ] = 1

        return df

    ####################################################
    # EXIT SIGNAL LOGIC
    ####################################################
    def populate_exit_trend(self, df: pd.DataFrame, metadata: dict) -> pd.DataFrame:
        df['exit_long'] = 0
        # This strategy relies on ROI, stoploss, and trailing_stop (via custom_stoploss) for exits.
        # No explicit indicator-based exit signals are generated here.
        return df

    ####################################################
    # CUSTOM STOPLOSS (ATR-based trailing stop implementation)
    ####################################################
    def custom_stoploss(self, pair: str, trade: Trade, current_time: datetime,
                        current_rate: float, current_profit: float, **kwargs) -> float:
        # This function is called by Freqtrade to determine a dynamic stoploss.
        # It should return a relative stoploss value (e.g., -0.01 for a 1% stop from current_rate).
        # A value of -1.0 tells Freqtrade to use the static `self.stoploss` value.

        # If profit is already below the hard stoploss, let the hard stoploss trigger.
        # Note: Freqtrade will take the "better" (less negative, or positive for profit) stop.
        # So if self.stoploss is -0.02 and this returns -0.05, Freqtrade uses -0.02.
        # If self.stoploss is -0.05 and this returns -0.02, Freqtrade uses -0.02.
        # This method effectively provides an *alternative* stoploss.

        try:
            dataframe, _ = self.dp.get_analyzed_dataframe(pair, self.timeframe)
            if dataframe.empty:
                logger.warning(f"Pair {pair}: Analyzed dataframe empty in custom_stoploss.")
                return -1.0  # Fallback to default stoploss

            last_candle = dataframe.iloc[-1].squeeze()
            if 'atr' not in last_candle or pd.isna(last_candle['atr']):
                logger.warning(f"Pair {pair}: ATR not available in custom_stoploss. ATR: {last_candle.get('atr')}")
                return -1.0 # Fallback

            atr_value = last_candle['atr']
            # Calculate stop distance based on ATR and multiplier
            stop_distance = atr_value * self.atr_mult.value

            # Calculate the relative stoploss from the current_rate
            # (stop_price / current_rate) - 1
            # stop_price = current_rate - stop_distance
            # so, ((current_rate - stop_distance) / current_rate) - 1
            # which simplifies to -(stop_distance / current_rate)
            relative_stoploss = - (stop_distance / current_rate)

            # Ensure it's a negative value to represent a loss
            return -abs(relative_stoploss)

        except Exception as e:
            logger.error(f"Error in custom_stoploss for {pair} (trade {trade.id}): {e}")
            return -1.0 # Fallback to default stoploss in case of any error

    ####################################################
    # CUSTOM STAKE AMOUNT
    ####################################################
    def custom_stake_amount(self, pair: str, current_time: datetime,
                            current_rate: float, proposed_stake: float,
                            min_stake: float, max_stake: float,
                            leverage: float, entry_tag: Optional[str], # entry_tag can be None
                            side: str, **kwargs) -> float:
        # Example: Risk 2% of available stake balance per trade
        try:
            balance = self.wallets.get_available_stake_amount()

            if balance is None or balance <= 0:
                logger.warning(f"Could not get valid available stake balance for {pair} (Balance: {balance}). Falling back to proposed_stake: {proposed_stake}")
                return max(min_stake, min(proposed_stake, max_stake))

            desired_risk_percentage = 0.02 # Risk 2%
            # For spot, leverage is 1. For futures, it's the trade leverage.
            effective_leverage = leverage if leverage and leverage > 0 else 1.0
            
            # Amount of stake currency to risk
            amount_to_risk = balance * desired_risk_percentage
            
            # This is the actual stake size based on the amount to risk
            calculated_stake = amount_to_risk / effective_leverage 

            final_stake = max(min_stake, min(calculated_stake, max_stake))
            
            # logger.info(f"CustomStake: Pair: {pair}, Balance: {balance:.2f}, Risk%: {desired_risk_percentage*100}%, Leverage: {effective_leverage}, CalcStake: {calculated_stake:.2f}, FinalStake: {final_stake:.2f}")
            return final_stake

        except Exception as e:
            logger.error(f"Error in custom_stake_amount for {pair}: {e}. Falling back to proposed_stake.")
            return max(min_stake, min(proposed_stake, max_stake))

    ####################################################
    # DCA (POSITION ADJUSTMENT) LOGIC
    ####################################################
    def adjust_trade_position(self, trade: Trade, current_time: datetime,
                              current_rate: float, current_profit: float,
                              min_stake: float, max_stake: float, **kwargs) -> Optional[float]:
        """
        Adjust position through DCA when specific loss thresholds are met.
        Returns the stake amount for the DCA entry, or None to not DCA.
        """
        if not self.position_adjustment_enable: # Check if DCA is enabled globally for the strategy
            return None

        # Ensure nr_of_successful_entries is available (it is for live/dry, not always backtest unless patched)
        if not hasattr(trade, 'nr_of_successful_entries'):
            logger.debug(f"Trade {trade.id} ({trade.pair}) missing 'nr_of_successful_entries'. Cannot DCA in this mode (likely backtest without full trade object).")
            return None

        # Check if max DCA entries have been reached
        # nr_of_successful_entries includes the initial entry.
        # So, if dca_max_entries is 2, it means initial + 2 DCA. Max entries = dca_max_entries + 1.
        if trade.nr_of_successful_entries > self.dca_max_entries.value:
            # logger.debug(f"Max DCA entries ({self.dca_max_entries.value}) reached for trade {trade.id} ({trade.pair}). Total entries: {trade.nr_of_successful_entries}.")
            return None

        # Only DCA if current profit is below the configured DCA threshold (dca_threshold is negative)
        if current_profit > self.dca_threshold.value:
            return None

        try:
            # Calculate stake amount for this DCA entry.
            # Example: Use the same logic as the initial stake (e.g., via custom_stake_amount).
            # We need to pass all relevant parameters to custom_stake_amount.
            stake_amount_for_dca = self.custom_stake_amount(
                pair=trade.pair,
                current_time=current_time,
                current_rate=current_rate, # Current rate is the trigger for DCA
                proposed_stake=trade.stake_amount / trade.nr_of_successful_entries, # As a suggestion, could be initial_stake
                min_stake=min_stake,
                max_stake=max_stake,
                leverage=trade.leverage,
                entry_tag=f"DCA_{trade.nr_of_successful_entries}", # Tag it as a DCA entry
                side=trade.trade_direction
            )

            if stake_amount_for_dca is None or stake_amount_for_dca < min_stake:
                 logger.warning(f"DCA for trade {trade.id} ({trade.pair}) aborted: Calculated DCA stake {stake_amount_for_dca} is less than min_stake {min_stake}.")
                 return None

            logger.info(
                f"DCA Triggered for trade {trade.id} ({trade.pair}): "
                f"Entry {trade.nr_of_successful_entries}/{self.dca_max_entries.value}, "
                f"Profit: {current_profit:.2%}, Threshold: {self.dca_threshold.value:.2%}. "
                f"Proposing to add stake: {stake_amount_for_dca:.2f}"
            )
            return stake_amount_for_dca

        except Exception as e:
            logger.error(f"Error in adjust_trade_position for {trade.pair} (trade {trade.id}): {e}")
            return None