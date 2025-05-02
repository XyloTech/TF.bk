# -- coding: utf-8 --
# BestScalpingDCA.py

from freqtrade.strategy import IStrategy, IntParameter, DecimalParameter
from freqtrade.persistence import Trade
import talib.abstract as ta
import pandas as pd
import numpy as np
from datetime import datetime
import logging

logger = logging.getLogger(__name__)

class BestScalpingDCA(IStrategy):
    """
    Focused scalper + DCA on top pairs (DOGE/USDT, INJ/USDT).
    Entry: EMA + SuperTrend + RSI filter
    Exit : ATR‐adaptive trailing stop + profit‐target ROI
    DCA  : 2 extra entries on drawdown
    Hyperopt ready: SuperTrend, RSI, ATR multipliers
    """

    ####################################################
    # CONFIGURATION
    ####################################################
    timeframe = '15m'
    startup_candle_count: int = 50
    process_only_new_candles = True
    use_custom_stoploss = True
    position_adjustment_enable = True

    minimal_roi = {"0": 0.05, "30": 0.03, "60": 0.01}
    stoploss = -0.02  # 2% hard stop

    trailing_stop = True
    trailing_only_offset_is_reached = True

    # hyperopt parameters
    st_period = IntParameter(7, 21, default=11, space="buy")
    st_multiplier = DecimalParameter(2.0, 4.0, default=3.0, space="buy")
    rsi_low   = IntParameter(20, 40, default=30, space="buy")
    rsi_high  = IntParameter(60, 80, default=70, space="sell")
    atr_mult  = DecimalParameter(1.5, 3.5, default=2.5, space="sell")

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
        st = ta.SUPERTREND(df['high'], df['low'], df['close'],
                           period=self.st_period.value,
                           multiplier=self.st_multiplier.value)
        df['super_trend'] = st['SUPERT_%d_%.1f' % (
            self.st_period.value, self.st_multiplier.value)]

        # ATR for exit
        df['atr'] = ta.ATR(df['high'], df['low'], df['close'], timeperiod=14)
        return df

    ####################################################
    # ENTRY SIGNAL
    ####################################################
    def populate_entry_trend(self, df: pd.DataFrame, metadata: dict) -> pd.DataFrame:
        df['enter_long'] = 0

        cond = (
            (df['close'] > df['ema20']) &
            (df['ema20'] > df['ema50']) &
            (df['super_trend'] == 1) &
            (df['rsi'] < self.rsi_low.value)
        )
        df.loc[cond, 'enter_long'] = 1
        return df

    ####################################################
    # EXIT SIGNAL (profit‐target via ROI + trailing stop in custom_stoploss)
    ####################################################
    def populate_exit_trend(self, df: pd.DataFrame, metadata: dict) -> pd.DataFrame:
        df['exit_long'] = 0
        # exit by ROI is handled automatically by minimal_roi
        return df

    ####################################################
    # CUSTOM STOPLOSS (ATR-based trailing stop)
    ####################################################
    def custom_stoploss(self, pair: str, trade: Trade, current_time: datetime,
                        current_rate: float, current_profit: float, **kwargs) -> float:
        # if below hard stop
        if current_profit < self.stoploss:
            return -1.0

        # ATR trailing stop
        df, _ = self.dp.get_analyzed_dataframe(pair, self.timeframe)
        atr = df['atr'].iat[-1]
        stop_price = current_rate - atr * self.atr_mult.value
        return (stop_price / current_rate) - 1.0

    ####################################################
    # CUSTOM STAKE (flat 5% of wallet)
    ####################################################
    def custom_stake_amount(self, pair: str, current_time: datetime,
                            current_rate: float, proposed_stake: float,
                            min_stake: float, max_stake: float,
                            leverage: float, entry_tag: Optional[str],
                            side: str, **kwargs) -> float:
        # risk 5% per entry
        balance = self.wallets.get_available() if hasattr(self.wallets, "get_available") else proposed_stake*20
        stake = (balance * 0.05) / (leverage or 1.0)
        return max(min_stake, min(stake, max_stake))

    ####################################################
    # DCA (up to 2 extra entries on -3.5% drawdown)
    ####################################################
    def adjust_trade_position(self, trade: Trade, current_time: datetime,
                              current_rate: float, current_profit: float,
                              min_stake: float, max_stake: float, **kwargs) -> Optional[float]:
        # only in live/dry-run
        if not hasattr(trade, 'nr_of_successful_entries'):
            return None

        # threshold from hyperopt
        threshold = self.dca_threshold.value
        max_dca = 2

        if trade.nr_of_successful_entries < max_dca and current_profit <= threshold:
            # stake same size as original
            return trade.open_amount  # re-use initial stake
        return None