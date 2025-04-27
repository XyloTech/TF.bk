# -- coding: utf-8 --
# SmartScalpingDCA.py

import logging
from datetime import datetime
from typing import Optional
import pandas as pd
import numpy as np
import talib.abstract as ta
from freqtrade.strategy import IStrategy
from freqtrade.persistence import Trade
from functools import reduce
from scipy.optimize import minimize

logger = logging.getLogger(_name_)


# ================== Settings ==================
class Config:
    RISK_PER_TRADE = 0.02  # 2% risk
    MAX_DCA_LEVELS = 3     # How many DCA orders allowed
    CORRELATION_LIMIT = 0.7
    OPTIMIZE_EVERY_X_DAYS = 7
    INITIAL_PARAMS = {
        'bb_length': 20,
        'bb_stddev': 2.0,
        'dca_atr_multiplier': 0.5
    }


# ================== SmartScalpingDCA Strategy ==================
class SmartScalpingDCA(IStrategy):
    # --- Base settings
    timeframe = '5m'
    minimal_roi = {"0": 0.01}
    stoploss = -0.03
    trailing_stop = True
    trailing_stop_positive = 0.004
    use_custom_stoploss = True
    process_only_new_candles = True
    startup_candle_count: int = 200

    def _init_(self, config: dict) -> None:
        super()._init_(config)
        self.opt_params = Config.INITIAL_PARAMS.copy()
        self.last_optimization: Optional[datetime] = None

    def bot_start(self, **kwargs) -> None:
        """Runs at bot start"""
        self.optimize_parameters()

    # ================== Indicators ==================
    def populate_indicators(self, df: pd.DataFrame, metadata: dict) -> pd.DataFrame:
        bb = ta.BBANDS(df['close'], timeperiod=self.opt_params['bb_length'], nbdevup=self.opt_params['bb_stddev'], nbdevdn=self.opt_params['bb_stddev'])
        df['bb_upper'], df['bb_middle'], df['bb_lower'] = bb['upperband'], bb['middleband'], bb['lowerband']

        df['ema50'] = ta.EMA(df['close'], timeperiod=50)
        df['ema200'] = ta.EMA(df['close'], timeperiod=200)
        df['rsi'] = ta.RSI(df['close'], timeperiod=14)
        df['adx'] = ta.ADX(df, timeperiod=14)
        df['atr'] = ta.ATR(df, timeperiod=14)
        df['volume_mean'] = ta.SMA(df['volume'], timeperiod=20)

        return df

    # ================== Entries ==================
    def populate_entry_trend(self, df: pd.DataFrame, metadata: dict) -> pd.DataFrame:
        conditions = []

        long = (
            (df['close'] < df['bb_lower']) &
            (df['volume'] > df['volume_mean']) &
            (df['ema50'] > df['ema200']) &
            (df['rsi'] < 30) &
            (df['adx'] > 20)
        )
        conditions.append(long)

        if conditions:
            df.loc[
                reduce(lambda x, y: x | y, conditions),
                'enter_long'
            ] = 1

        return df

    # ================== Exits ==================
    def populate_exit_trend(self, df: pd.DataFrame, metadata: dict) -> pd.DataFrame:
        df['exit_long'] = 0

        exit_condition = (
            (df['close'] > df['bb_upper']) |
            (df['rsi'] > 70)
        )
        df.loc[exit_condition, 'exit_long'] = 1

        return df

    # ================== Custom Stake Size (Risk based) ==================
    def custom_stake_amount(self, pair: str, current_time: datetime, current_rate: float,
                            proposed_stake: float, min_stake: float, max_stake: float,
                            leverage: float, entry_tag: Optional[str], side: str, **kwargs) -> float:
        balance = self.wallets.get_total_balance()
        max_risk = Config.RISK_PER_TRADE * balance

        dca_level = int(entry_tag.split('')[-1]) if entry_tag and '' in entry_tag else 0

        df, _ = self.dp.get_analyzed_dataframe(pair, self.timeframe)
        atr = df['atr'].iloc[-1]
        dca_distance = atr * self.opt_params['dca_atr_multiplier']

        if dca_level == 0:
            stake = max_risk / leverage
        else:
            stake = (max_risk * (1.5 ** (dca_level - 1))) / leverage

        return min(stake, max_stake)

    # ================== Custom Stoploss ==================
    def custom_stoploss(self, pair: str, trade: Trade, current_time: datetime,
                        current_rate: float, current_profit: float, **kwargs) -> float:
        if trade.nr_of_successful_entries > 1:
            return -0.015  # tighter after DCA
        return -0.03

    # ================== Confirm Entries ==================
    def confirm_trade_entry(self, pair: str, order_type: str, amount: float,
                             rate: float, time_in_force: str, **kwargs) -> bool:
        # Correlation Check
        for open_trade in Trade.get_open_trades():
            if open_trade.pair == pair:
                continue
            corr = self.calculate_correlation(pair, open_trade.pair)
            if corr > Config.CORRELATION_LIMIT:
                logger.warning(f"⚠ Correlated {pair} with {open_trade.pair}: {corr:.2f}")
                return False

        # Volatility Check (no movement = no trade)
        df, _ = self.dp.get_analyzed_dataframe(pair, self.timeframe)
        if df['close'].pct_change(288).iloc[-1] < 0.015:
            return False

        return True

    # ================== Optimization ==================
    def optimize_parameters(self) -> None:
        if self.last_optimization and (datetime.now() - self.last_optimization).days < Config.OPTIMIZE_EVERY_X_DAYS:
            return

        logger.info("🚀 Optimizing Parameters...")

        bounds = [
            (15, 25),  # bb_length
            (1.5, 2.5), # bb_stddev
            (0.3, 1.0)  # dca_atr_multiplier
        ]

        def objective(params):
            bb_length, bb_stddev, dca_multiplier = params
            return -self.simulate_profit(bb_length, bb_stddev, dca_multiplier)

        result = minimize(objective, [20, 2.0, 0.5], bounds=bounds, method='L-BFGS-B')

        self.opt_params = {
            'bb_length': int(result.x[0]),
            'bb_stddev': round(result.x[1], 2),
            'dca_atr_multiplier': round(result.x[2], 2)
        }
        self.last_optimization = datetime.now()

        logger.info(f"✅ Optimization Complete: {self.opt_params}")

    # ================== Simulate Profit (basic offline) ==================
    def simulate_profit(self, bb_length: int, bb_stddev: float, dca_multiplier: float) -> float:
        df, _ = self.dp.get_analyzed_dataframe('BTC/USDT', self.timeframe)
        if df is None or df.empty:
            return 0

        df['bb_upper'], df['bb_middle'], df['bb_lower'] = ta.BBANDS(df['close'], timeperiod=int(bb_length), nbdevup=bb_stddev, nbdevdn=bb_stddev).values()
        df['rsi'] = ta.RSI(df['close'], timeperiod=14)

        entries = (df['close'] < df['bb_lower']) & (df['rsi'] < 30)
        exits = (df['close'] > df['bb_upper']) | (df['rsi'] > 70)

        returns = []
        in_position = False
        entry_price = 0

        for idx in range(len(df)):
            if not in_position and entries.iloc[idx]:
                entry_price = df['close'].iloc[idx]
                in_position = True
            elif in_position and exits.iloc[idx]:
                profit = (df['close'].iloc[idx] - entry_price) / entry_price
                returns.append(profit)
                in_position = False

        total_profit = sum(returns)
        return total_profit

    # ================== Correlation Calculation ==================
    def calculate_correlation(self, pair1: str, pair2: str) -> float:
        df1, _ = self.dp.get_analyzed_dataframe(pair1, self.timeframe)
        df2, _ = self.dp.get_analyzed_dataframe(pair2, self.timeframe)

        if df1 is None or df2 is None or len(df1) != len(df2):
            return 0

        return df1['close'].corr(df2['close'])


# Add to SmartScalpingDCA.py
if __name__ == '__main__':
    print("Strategy module loaded")