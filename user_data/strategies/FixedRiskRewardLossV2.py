# pragma pylint: disable=missing-docstring, invalid-name, pointless-string-statement
# isort: skip_file
# --- Do not remove these libs ---
import numpy as np  # noqa
import pandas as pd  # noqa
from pandas import DataFrame

from freqtrade.strategy import IStrategy

# --------------------------------
# Add your lib to import here
import talib.abstract as ta
import freqtrade.vendor.qtpylib.indicators as qtpylib
from datetime import datetime
from freqtrade.persistence import Trade

import logging
logger = logging.getLogger(__name__)

class FixedRiskRewardLossV2(IStrategy):
    """
    This strategy uses custom_stoploss() to enforce a fixed risk/reward ratio
    by first calculating a dynamic initial stoploss via ATR - last negative peak

    After that, we caculate that initial risk and multiply it with an risk_reward_ratio
    Once this is reached, stoploss is set to it and sell signal is enabled

    Also there is a break even ratio. Once this is reached, the stoploss is adjusted to minimize
    losses by setting it to the buy rate + fees.
    """

    INTERFACE_VERSION: int = 3
    timeframe = '5m'
    stake_currency = 'USDT'

    custom_info = {
        'risk_reward_ratio': 3.5,
        'set_to_break_even_at_profit': 1,
    }
    use_custom_stoploss = True
    stoploss = -0.9

    # Define the stake amount as a percentage of the available capital
    # This will be overridden if stake_amount is set in the config.json
    stake_amount = '5%'

    # Define minimum and maximum entry capital for the strategy
    # Trades will only be placed if the account balance is within this range
    min_entry_capital = 100  # Minimum account balance in USDT
    max_entry_capital = 20000 # Maximum account balance in USDT

    def custom_stoploss(self, pair: str, trade: 'Trade', current_time: datetime,
                        current_rate: float, current_profit: float, **kwargs) -> float:

        """
            custom_stoploss using a risk/reward ratio
        """
        result = break_even_sl = takeprofit_sl = -1
        custom_info_pair = self.custom_info.get(pair)
        if custom_info_pair is not None:
            # using current_time/open_date directly via custom_info_pair[trade.open_daten]
            # would only work in backtesting/hyperopt.
            # in live/dry-run, we have to search for nearest row before it
            open_date_mask = custom_info_pair.index.unique().get_loc(trade.open_date_utc)
            open_df = custom_info_pair.iloc[open_date_mask]

            # trade might be open too long for us to find opening candle
            if open_df is None or open_df.empty:
                return -1 # won't update current stoploss

            initial_sl_abs = open_df['stoploss_rate']

            # calculate initial stoploss at open_date
            initial_sl = initial_sl_abs/current_rate-1

            # calculate take profit treshold
            # by using the initial risk and multiplying it
            risk_distance = trade.open_rate-initial_sl_abs
            reward_distance = risk_distance*self.custom_info['risk_reward_ratio']
            # take_profit tries to lock in profit once price gets over
            # risk/reward ratio treshold
            take_profit_price_abs = trade.open_rate+reward_distance
            # take_profit gets triggerd at this profit
            take_profit_pct = take_profit_price_abs/trade.open_rate-1

            # break_even tries to set sl at open_rate+fees (0 loss)
            break_even_profit_distance = risk_distance*self.custom_info['set_to_break_even_at_profit']
            # break_even gets triggerd at this profit
            break_even_profit_pct = (break_even_profit_distance+current_rate)/current_rate-1

            result = initial_sl
            if(current_profit >= break_even_profit_pct):
                break_even_sl = (trade.open_rate*(1+trade.fee_open+trade.fee_close) / current_rate)-1
                result = break_even_sl

            if(current_profit >= take_profit_pct):
                takeprofit_sl = take_profit_price_abs/current_rate-1
                result = takeprofit_sl

        return result

    def populate_indicators(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe['atr'] = ta.ATR(dataframe)
        dataframe['stoploss_rate'] = dataframe['close']-(dataframe['atr']*2)
        self.custom_info[metadata['pair']] = dataframe[['date', 'stoploss_rate']].copy().set_index('date')

        # all "normal" indicators:
        # e.g.
        # dataframe['rsi'] = ta.RSI(dataframe)
        return dataframe

    def populate_entry_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        """
        Based on TA indicators, populates the buy signal for the given dataframe
        :param dataframe: DataFrame
        :return: DataFrame with buy column
        """

        # Entry condition: Example using RSI and SMA
        # This is a simple example to generate multiple trades for backtesting.
        # You can replace this with more sophisticated indicators and conditions.
        dataframe['rsi'] = ta.RSI(dataframe, timeperiod=14)
        dataframe['sma'] = ta.SMA(dataframe, timeperiod=20)

        dataframe['crossed_above_sma'] = qtpylib.crossed_above(dataframe['close'], dataframe['sma'])

        # Check capital limits
        wallet_balance = self.wallets.get_total('USDT')
        logger.debug(f"Wallet balance: {wallet_balance} USDT, Min Entry Capital: {self.min_entry_capital} USDT, Max Entry Capital: {self.max_entry_capital} USDT")
        if wallet_balance < self.min_entry_capital or wallet_balance > self.max_entry_capital:
            logger.debug(f"Wallet balance {wallet_balance} is outside of min ({self.min_entry_capital}) and max ({self.max_entry_capital}) entry capital. Setting enter_long to 0.")
            dataframe['enter_long'] = 0
            return dataframe

        dataframe.loc[
            ((dataframe['rsi'] < 40) & (dataframe['close'] > dataframe['sma'])) |
            ((dataframe['rsi'] < 45) & (dataframe['crossed_above_sma']))
        , 'enter_long'] = 1

        return dataframe

    def populate_exit_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        """
        Placeholder Strategy: does nothing
        Based on TA indicators, populates the sell signal for the given dataframe
        :param dataframe: DataFrame
        :return: DataFrame with buy column
        """

        # Never sells
        dataframe.loc[:, 'exit_long'] = 0
        return dataframe