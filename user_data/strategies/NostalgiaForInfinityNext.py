import copy
import logging
import pathlib
import rapidjson
import freqtrade.vendor.qtpylib.indicators as qtpylib
import numpy as np
import talib.abstract as ta
from freqtrade.strategy.interface import IStrategy
from freqtrade.strategy import merge_informative_pair, timeframe_to_minutes
from freqtrade.exchange import timeframe_to_prev_date
from freqtrade.data.dataprovider import DataProvider
from pandas import DataFrame, Series, concat
from functools import reduce
import math
from typing import Dict
from freqtrade.persistence import Trade
from datetime import datetime, timedelta
from technical.util import resample_to_interval, resampled_merge
from technical.indicators import zema, VIDYA, ichimoku
import pandas_ta as pta
import time
from freqtrade.strategy import DecimalParameter, CategoricalParameter

log = logging.getLogger(__name__)
#log.setLevel(logging.DEBUG)

###########################################################################################################
##                NostalgiaForInfinityV8 by iterativ                                                     ##
##           https://github.com/iterativv/NostalgiaForInfinity                                           ##
##
##
##   BEP20/BSC (ETH, BNB, ...): 0x86A0B21a20b39d16424B7c8003E4A7e12d78ABEe                               ##
##                                                                                                       ##
##               REFERRAL LINKS                                                                          ##
##                                                                                                       ##
##  Binance: https://accounts.binance.com/en/register?ref=EAZC47FM (5% discount on trading fees)         ##
##  Kucoin: https://www.kucoin.com/r/QBSSSPYV (5% discount on trading fees)

class NostalgiaForInfinityNext(IStrategy):
    """
    NostalgiaForInfinityNext strategy
    """

    # Strategy interface
    timeframe = '5m'
    minimal_roi = {
        "0": 0.069,
        "7": 0.03,
        "14": 0.004,
        "35": 0
    }

    stoploss = -0.273
    trailing_stop = True
    trailing_stop_positive = 0.01
    trailing_stop_positive_offset = 0.02
    trailing_only_offset_is_reached = True

    use_sell_signal = True
    sell_profit_only = False
    ignore_roi_if_buy_signal = False

    process_only_new_candles = True
    startup_candle_count = 200

    # Optimized parameters from hyperopt
    buy_cti_enable = True
    buy_cti_value = -0.29
    buy_rsi_enable = False
    buy_rsi_value = 18.8

    def populate_indicators(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        """
        Adds several different TA indicators to the given DataFrame
        """
        # RSI
        dataframe['rsi'] = ta.RSI(dataframe)

        # EMA
        dataframe['ema50'] = ta.EMA(dataframe, timeperiod=50)
        dataframe['ema200'] = ta.EMA(dataframe, timeperiod=200)

        # CTI
        dataframe['cti'] = pta.cti(dataframe['close'])

        return dataframe

    def populate_entry_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        """
        Based on TA indicators, populates the buy signal for the given dataframe
        """
        dataframe.loc[:, 'buy'] = 0
        dataframe.loc[:, 'buy_tag'] = ''

        conditions = []
        for index in range(1, 6):
            item_buy_logic = []
            if self.buy_rsi_enable:
                item_buy_logic.append(dataframe['rsi'] < self.buy_rsi_value)
            item_buy_logic.append(dataframe['close'] < dataframe['ema50'])
            if self.buy_cti_enable:
                item_buy_logic.append(dataframe['cti'] > self.buy_cti_value)
            item_buy_logic.append(dataframe['volume'] > 0)
            item_buy = reduce(lambda x, y: x & y, item_buy_logic)
            dataframe.loc[item_buy, 'buy_tag'] += f"{index} "
            conditions.append(item_buy)

        if conditions:
            dataframe.loc[:, 'buy'] = reduce(lambda x, y: x | y, conditions)

        return dataframe

    sell_cti_enable = True
    sell_cti_value = -0.43
    sell_rsi_enable = True
    sell_rsi_value = 70.7

    def populate_exit_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        """
        Based on TA indicators, populates the sell signal for the given dataframe
        """
        dataframe.loc[:, 'sell'] = 0

        conditions = []
        for index in range(1, 6):
            item_sell_logic = []
            if self.sell_rsi_enable:
                item_sell_logic.append(dataframe['rsi'] > self.sell_rsi_value)
            item_sell_logic.append(dataframe['close'] > dataframe['ema50'])
            if self.sell_cti_enable:
                item_sell_logic.append(dataframe['cti'] < self.sell_cti_value)
            item_sell_logic.append(dataframe['volume'] > 0)
            item_sell = reduce(lambda x, y: x & y, item_sell_logic)
            conditions.append(item_sell)

        if conditions:
            dataframe.loc[:, 'sell'] = reduce(lambda x, y: x | y, conditions)

        return dataframe

    def confirm_trade_exit(self, pair: str, trade: Trade, order_type: str, amount: float,
                          rate: float, time_in_force: str, sell_reason: str,
                          current_time: datetime, **kwargs) -> bool:
        """
        Called right before placing a regular sell order.
        Timing for this function is critical, so avoid doing heavy computations here.
        """
        return True