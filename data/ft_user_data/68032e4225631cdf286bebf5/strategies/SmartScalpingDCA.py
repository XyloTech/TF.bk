# -*- coding: utf-8 -*-
import logging
from datetime import datetime
from typing import Dict, List, Optional
import pandas as pd
import talib.abstract as ta
from freqtrade.strategy import IStrategy, DecimalParameter, IntParameter
from freqtrade.persistence import Trade

logger = logging.getLogger(__name__)

class SmartScalpingDCA(IStrategy):
    # Strategy configuration
    timeframe = '15m'
    can_short = False
    
    # ROI configuration
    minimal_roi = {
        "0": 0.03,  # 3% profit target
        "30": 0.02,  # After 30 minutes, 2%
        "60": 0.01,  # After 60 minutes, 1%
        "120": 0  # After 120 minutes, 0% (let custom exit handle)
    }
    
    # Stoploss configuration
    stoploss = -0.50  # Hard stoploss (50%)
    use_custom_stoploss = True
    
    # Trailing stop
    trailing_stop = True
    trailing_stop_positive = 0.01
    trailing_stop_positive_offset = 0.02
    trailing_only_offset_is_reached = True
    
    # Order types
    order_types = {
        'entry': 'limit',
        'exit': 'limit',
        'stoploss': 'market',
        'stoploss_on_exchange': True
    }
    
    # DCA configuration
    position_adjustment_enable = True
    max_entry_position_adjustment = 3  # Maximum 3 additional entries
    
    # Risk management
    risk_per_trade = 0.015  # 1.5% per trade
    dca_multiplier = 1.6
    
    # Protections
    protections = [
        {
            "method": "CooldownPeriod",
            "stop_duration_candles": 5
        }
    ]

    # Hyperoptable parameters
    buy_rsi = IntParameter(20, 40, default=35, space='buy')
    sell_rsi = IntParameter(60, 80, default=65, space='sell')
    atr_multiplier = DecimalParameter(0.5, 3.0, default=1.2, space='buy')

    def __init__(self, config: dict) -> None:
        super().__init__(config)
        self.safety_orders_active = {}

    def populate_indicators(self, df: pd.DataFrame, metadata: dict) -> pd.DataFrame:
        # EMA Indicators
        df['ema20'] = ta.EMA(df, timeperiod=20)
        df['ema50'] = ta.EMA(df, timeperiod=50)
        
        # Momentum Indicators
        df['rsi'] = ta.RSI(df, timeperiod=14)
        
        # Volatility Indicators
        df['atr'] = ta.ATR(df, timeperiod=14)
        
        # Volume Indicators
        df['volume_ma'] = ta.SMA(df, timeperiod=20, price='volume')
        
        return df

    def populate_entry_trend(self, df: pd.DataFrame, metadata: dict) -> pd.DataFrame:
        # Long entry conditions
        df.loc[
            (
                (df['ema20'] > df['ema50']) &
                (df['rsi'] < self.buy_rsi.value) &
                (df['close'] < df['ema20']) &
                (df['volume'] > df['volume_ma'])
            ),
            'enter_long'] = 1

        # Short entry conditions
        df.loc[
            (
                (df['ema20'] < df['ema50']) &
                (df['rsi'] > self.sell_rsi.value) &
                (df['close'] > df['ema20']) &
                (df['volume'] > df['volume_ma'])
            ),
            'enter_short'] = 1

        return df

    def confirm_trade_entry(self, pair: str, order_type: str, amount: float,
                          rate: float, time_in_force: str, side: str, **kwargs) -> bool:
        # Prevent new entries when DCA is active
        if self.safety_orders_active.get(pair, 0) > 0:
            return False
        return True

    def adjust_trade_position(self, trade: Trade, current_time: datetime,
                            current_rate: float, current_profit: float,
                            min_stake: float, max_stake: float, **kwargs) -> Optional[float]:
        pair = trade.pair
        dataframe, _ = self.dp.get_analyzed_dataframe(pair, self.timeframe)
        
        # Get current ATR value
        current_atr = dataframe['atr'].iloc[-1]
        dca_trigger = current_atr * self.atr_multiplier.value
        
        # Calculate price movement from entry
        if trade.is_short:
            price_movement = current_rate - trade.open_rate
        else:
            price_movement = trade.open_rate - current_rate
        
        # Check if we should DCA
        dca_level = self.safety_orders_active.get(pair, 0)
        if price_movement >= dca_trigger * (dca_level + 1):
            # Calculate new stake amount
            balance = self.wallets.get_total_balance()
            stake_amount = (self.risk_per_trade * balance * (self.dca_multiplier ** (dca_level + 1))) / trade.leverage
            
            # Update DCA level
            self.safety_orders_active[pair] = dca_level + 1
            
            return min(stake_amount, max_stake)
        
        return None

    def custom_stoploss(self, pair: str, trade: Trade, current_time: datetime,
                       current_rate: float, current_profit: float, **kwargs) -> float:
        # Dynamic stoploss based on DCA level
        dca_level = self.safety_orders_active.get(pair, 0)
        
        # Gradually tighten stoploss as we add positions
        if dca_level == 1:
            return -0.30  # 30% after first DCA
        elif dca_level >= 2:
            return -0.20  # 20% after second DCA
        
        return self.stoploss

    def custom_exit(self, pair: str, trade: Trade, current_time: datetime,
                   current_rate: float, current_profit: float, **kwargs) -> Optional[str]:
        # Early exit if we hit our profit target
        if current_profit >= 0.03:  # 3% target
            return 'take_profit'
            
        # Exit if RSI goes against our position
        dataframe, _ = self.dp.get_analyzed_dataframe(pair, self.timeframe)
        last_rsi = dataframe['rsi'].iloc[-1]
        
        if trade.is_short and last_rsi < 30:
            return 'rsi_exit_short'
        elif not trade.is_short and last_rsi > 70:
            return 'rsi_exit_long'
            
        return None

    def populate_exit_trend(self, df: pd.DataFrame, metadata: dict) -> pd.DataFrame:
        return df

    def leverage(self, pair: str, current_time: datetime, current_rate: float,
                proposed_leverage: float, max_leverage: float, side: str,
                **kwargs) -> float:
        # Limit leverage based on DCA level
        dca_level = self.safety_orders_active.get(pair, 0)
        return min(3.0, max_leverage) / (dca_level + 1)