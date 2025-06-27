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

class SmartScalpingDCA(IStrategy):
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

    def populate_indicators(self, df: pd.DataFrame, metadata: dict) -> pd.DataFrame:
        # EMA indicators
        df['ema20'] = ta.EMA(df['close'], timeperiod=20)
        df['ema50'] = ta.EMA(df['close'], timeperiod=50)
        
        # RSI
        df['rsi'] = ta.RSI(df['close'], timeperiod=14)
        
        # Stochastic
        slowk, slowd = ta.STOCH(df['high'], df['low'], df['close'])
        df['stoch_k'] = slowk
        df['stoch_d'] = slowd
        
        # ATR for volatility
        df['atr'] = ta.ATR(df, timeperiod=14)
        
        # Volume analysis
        df['volume_ma'] = ta.SMA(df['volume'], timeperiod=20)
        
        return df

    def populate_entry_trend(self, df: pd.DataFrame, metadata: dict) -> pd.DataFrame:
        df['enter_long'] = 0
        df['enter_short'] = 0

        # Focus on the best performing pairs from original backtest
        best_pairs = ['INJ/USDT', 'SOL/USDT', 'DOGE/USDT', 'AVAX/USDT', 'NEAR/USDT', 'LINK/USDT']
        current_pair = metadata['pair']
        
        if current_pair in best_pairs:
            # More selective entry conditions
            df.loc[
                (df['ema20'] > df['ema50']) &  # Uptrend
                (df['rsi'] < 50) &  # Not overbought
                (df['rsi'] > 30) &  # Not too oversold
                (df['close'] > df['ema20']) &  # Price above EMA20
                (df['volume'] > df['volume_ma'] * 0.8),  # Decent volume
                'enter_long'
            ] = 1
            
            df.loc[
                (df['ema20'] < df['ema50']) &  # Downtrend
                (df['rsi'] > 50) &  # Not oversold
                (df['rsi'] < 70) &  # Not too overbought
                (df['close'] < df['ema20']) &  # Price below EMA20
                (df['volume'] > df['volume_ma'] * 0.8),  # Decent volume
                'enter_short'
            ] = 1

        return df

    def populate_exit_trend(self, df: pd.DataFrame, metadata: dict) -> pd.DataFrame:
        # No exit signals - rely completely on ROI and trailing stop
        df['exit_long'] = 0
        df['exit_short'] = 0
        return df

    def custom_stoploss(self, pair: str, trade: Trade, current_time: datetime,
                        current_rate: float, current_profit: float, **kwargs) -> float:
        # Dynamic stoploss based on profit
        if current_profit >= 0.02:  # If we're up by 2%
            return -0.01  # Tight 1% stoploss to protect profits
        elif current_profit >= 0.01:  # If we're up by 1%
            return -0.02  # 2% stoploss
        
        # Default stoploss
        return -0.05  # 5% stoploss

    def adjust_trade_position(self, trade: Trade, current_time: datetime,
                              current_rate: float, current_profit: float,
                              min_stake: float, max_stake: float, **kwargs) -> Optional[float]:
        """
        Simple DCA implementation
        """
        # Only DCA for the best performing pairs
        best_pairs = ['INJ/USDT', 'SOL/USDT', 'DOGE/USDT', 'AVAX/USDT', 'NEAR/USDT', 'LINK/USDT']
        
        if trade.pair in best_pairs:
            max_dca_count = 1  # Only one DCA per trade
            dca_threshold = -0.03  # At loss greater than 3%
            
            if trade.nr_of_successful_entries < max_dca_count and current_profit <= dca_threshold:
                stake_amount = min_stake
                return stake_amount  # Execute DCA
        
        return None