# -- coding: utf-8 --
# SmartScalpingDCA_ROI.py

from freqtrade.strategy import IStrategy
from freqtrade.persistence import Trade
import talib.abstract as ta
import pandas as pd
from datetime import datetime
from typing import Optional
import logging

logger = logging.getLogger(__name__)

class SampleEmaRsiStrategy(IStrategy):
    """
    ROI-focused version of SmartScalping strategy
    """
    
    # Strategy parameters
    timeframe = '15m'
    startup_candle_count = 100
    process_only_new_candles = True

    # ROI and stoploss settings - Optimized for quick profits
    minimal_roi = {
        "0": 0.03,    # 3% profit target
        "30": 0.02,   # 2% profit after 30 minutes
        "60": 0.015,  # 1.5% profit after 60 minutes
        "90": 0.01    # 1% profit after 90 minutes
    }
    stoploss = -0.05  # 5% stoploss

    # Trailing stop settings - Optimized based on results
    trailing_stop = True
    trailing_stop_positive = 0.01  # 1% distance from highest price
    trailing_stop_positive_offset = 0.015  # 1.5% above highest price
    trailing_only_offset_is_reached = True  # Only activate when offset is reached

    # Strategy features
    use_custom_stoploss = True
    position_adjustment_enable = True  # Enable DCA

    # Order settings
    order_types = {
        'entry': 'limit',
        'exit': 'limit',
        'stoploss': 'market',
        'stoploss_on_exchange': False,
        'stoploss_on_exchange_interval': 60
    }

    order_time_in_force = {
        'entry': 'GTC',
        'exit': 'GTC'
    }

    def populate_indicators(self, dataframe: pd.DataFrame, metadata: dict) -> pd.DataFrame:
        # EMA indicators
        dataframe['ema20'] = ta.EMA(dataframe['close'], timeperiod=20)  # type: ignore
        dataframe['ema50'] = ta.EMA(dataframe['close'], timeperiod=50)  # type: ignore
        
        # RSI
        dataframe['rsi'] = ta.RSI(dataframe['close'], timeperiod=14)  # type: ignore
        
        # Stochastic
        slowk, slowd = ta.STOCH(dataframe['high'], dataframe['low'], dataframe['close'])  # type: ignore
        dataframe['stoch_k'] = slowk
        dataframe['stoch_d'] = slowd
        
        # ATR for volatility
        dataframe['atr'] = ta.ATR(dataframe, timeperiod=14)  # type: ignore
        
        # Volume analysis
        dataframe['volume_ma'] = ta.SMA(dataframe['volume'], timeperiod=20)  # type: ignore
        
        return dataframe

    def populate_entry_trend(self, dataframe: pd.DataFrame, metadata: dict) -> pd.DataFrame:
        dataframe['enter_long'] = 0
        dataframe['enter_short'] = 0

        # Focus on the best performing pairs from original backtest
        best_pairs = ['INJ/USDT', 'SOL/USDT', 'DOGE/USDT', 'AVAX/USDT', 'NEAR/USDT', 'LINK/USDT']
        current_pair = metadata['pair']
        
        if current_pair in best_pairs:
            # More selective entry conditions
            dataframe.loc[
                (dataframe['ema20'] > dataframe['ema50']) &
                (dataframe['rsi'] < 50) &
                (dataframe['rsi'] > 30) &
                (dataframe['close'] > dataframe['ema20']) &
                (dataframe['volume'] > dataframe['volume_ma'] * 0.8),
                'enter_long'
            ] = 1
            
            dataframe.loc[
                (dataframe['ema20'] < dataframe['ema50']) &
                (dataframe['rsi'] > 50) &
                (dataframe['rsi'] < 70) &
                (dataframe['close'] < dataframe['ema20']) &
                (dataframe['volume'] > dataframe['volume_ma'] * 0.8),
                'enter_short'
            ] = 1
            # More selective entry conditions
            dataframe.loc[
                (dataframe['ema20'] > dataframe['ema50']) &  # Uptrend
                (dataframe['rsi'] < 50) &  # Not overbought
                (dataframe['rsi'] > 30) &  # Not too oversold
                (dataframe['close'] > dataframe['ema20']) &  # Price above EMA20
                (dataframe['volume'] > dataframe['volume_ma'] * 0.8),
                'enter_long'
            ] = 1
            
            dataframe.loc[
                (dataframe['ema20'] < dataframe['ema50']) &  # Downtrend
                (dataframe['rsi'] > 50) &  # Not oversold
                (dataframe['rsi'] < 70) &  # Not too overbought
                (dataframe['close'] < dataframe['ema20']) &  # Price below EMA20
                (dataframe['volume'] > dataframe['volume_ma'] * 0.8),
                'enter_short'
            ] = 1

        return dataframe

    def populate_exit_trend(self, dataframe: pd.DataFrame, metadata: dict) -> pd.DataFrame:
        # No exit signals - rely completely on ROI and trailing stop
        dataframe['exit_long'] = 0
        dataframe['exit_short'] = 0
        return dataframe
        dataframe['exit_long'] = 0
        dataframe['exit_short'] = 0
        return dataframe

    def custom_stoploss(self, pair: str, trade: Trade, current_time: datetime,
                        current_rate: float, current_profit: float, after_fill: bool, **kwargs) -> float | None:
        # Dynamic stoploss based on profit
        # The 'after_fill' parameter is not used in this specific logic but is required by the interface.
        if current_profit >= 0.02:  # If we're up by 2%
            return -0.01  # Tight 1% stoploss to protect profits
        elif current_profit >= 0.01:  # If we're up by 1%
            return -0.02  # 2% stoploss
        
        # Default stoploss
        return -0.05  # 5% stoploss

    def adjust_trade_position(self, trade: Trade, current_time: datetime,
                              current_rate: float, current_profit: float,
                              min_stake: float | None, max_stake: float,
                              current_entry_rate: float, current_exit_rate: float,
                              current_entry_profit: float, current_exit_profit: float,
                              **kwargs) -> Optional[float]:
        """
        Simple DCA implementation
        """
        # The following parameters are required by the interface but not directly used in this DCA logic:
        # current_entry_rate, current_exit_rate, current_entry_profit, current_exit_profit

        # Only DCA for the best performing pairs
        best_pairs = ['INJ/USDT', 'SOL/USDT', 'DOGE/USDT', 'AVAX/USDT', 'NEAR/USDT', 'LINK/USDT']
        
        if trade.pair in best_pairs:
            max_dca_count = 1  # Only one DCA per trade
            dca_threshold = -0.03  # At loss greater than 3%
            
            if trade.nr_of_successful_entries < max_dca_count and current_profit <= dca_threshold:
                stake_amount = min_stake
                return stake_amount  # Execute DCA
        
        return None