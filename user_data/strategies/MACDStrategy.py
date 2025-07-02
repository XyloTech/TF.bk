
# --- Do not remove these libs ---
from freqtrade.strategy import IStrategy
from freqtrade.strategy import CategoricalParameter, DecimalParameter, IntParameter
from pandas import DataFrame
# --------------------------------

import talib.abstract as ta


class MACDStrategy(IStrategy):
    """
    author@: Gert Wohlgemuth

    idea:

        uptrend definition:
            MACD above MACD signal
            and CCI < -50

        downtrend definition:
            MACD below MACD signal
            and CCI > 100

    freqtrade hyperopt --strategy MACDStrategy --hyperopt-loss <someLossFunction> --spaces buy sell

    The idea is to optimize only the CCI value.
    - Buy side: CCI between -700 and 0
    - Sell side: CCI between 0 and 700

    """
    INTERFACE_VERSION: int = 3

    # Minimal ROI designed for the strategy.
    # This attribute will be overridden if the config file contains "minimal_roi"
    minimal_roi = {
        "0": 0.03,
        "10": 0.02,
        "30": 0.015,
        "60": 0
    }

    # Optimal stoploss designed for the strategy
    stoploss = -0.217
    trailing_stop = True
    trailing_stop_positive = 0.005
    trailing_stop_positive_offset = 0.01
    trailing_only_offset_is_reached = True
    startup_candle_count = 200

    # Optimal timeframe for the strategy
    timeframe = '1m'

    buy_cci = IntParameter(low=-1000, high=0, default=-50, space='buy', optimize=True)
    sell_cci = IntParameter(low=0, high=1000, default=100, space='sell', optimize=True)

    # Buy hyperspace params:
    buy_params = {
        "buy_cci": -100,
    }

    # Sell hyperspace params:
    sell_params = {
        "sell_cci": 100,
    }

    def populate_indicators(self, dataframe: DataFrame, metadata: dict) -> DataFrame:

        macd, macdsignal, macdhist = ta.MACD(dataframe)
        dataframe['macd'] = macd
        dataframe['macdsignal'] = macdsignal
        dataframe['macdhist'] = macdhist

        dataframe['cci'] = ta.CCI(dataframe)
        self.dp.send_msg(f"MACD: {dataframe['macd'].iloc[-1]}, Signal: {dataframe['macdsignal'].iloc[-1]}, Hist: {dataframe['macdhist'].iloc[-1]}, CCI: {dataframe['cci'].iloc[-1]}")


        return dataframe

    def populate_entry_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        """
        Based on TA indicators, populates the buy signal for the given dataframe
        :param dataframe: DataFrame
        :return: DataFrame with buy column
        """
        # Check for buy signals


        self.dp.send_msg(f"enter_long conditions: macd_gt_macdsignal={dataframe['macd'].iloc[-1] > dataframe['macdsignal'].iloc[-1]}, macd_cross_up={dataframe['macd'].shift(1).iloc[-1] <= dataframe['macdsignal'].shift(1).iloc[-1]}, cci_le_buy_cci={dataframe['cci'].iloc[-1] <= -self.buy_cci.value}, volume_gt_0={dataframe['volume'].iloc[-1] > 0}")
        dataframe.loc[
            (
                (dataframe['macd'] > dataframe['macdsignal']) &
                (dataframe['macd'].shift(1) <= dataframe['macdsignal'].shift(1)) &
                (dataframe['cci'] <= -self.buy_cci.value) &
                (dataframe['volume'] > 0)  # Make sure there is volume.
            ),
            'enter_long'] = 1

        return dataframe

    def populate_exit_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        """
        Based on TA indicators, populates the sell signal for the given dataframe
        :param dataframe: DataFrame
        :return: DataFrame with buy column
        """
        # Check for sell signals


        self.dp.send_msg(f"exit_long conditions: macd_lt_macdsignal={dataframe['macd'].iloc[-1] < dataframe['macdsignal'].iloc[-1]}, macd_cross_down={dataframe['macd'].shift(1).iloc[-1] >= dataframe['macdsignal'].shift(1).iloc[-1]}, cci_ge_sell_cci={dataframe['cci'].iloc[-1] >= self.sell_cci.value}, volume_gt_0={dataframe['volume'].iloc[-1] > 0}")
        dataframe.loc[
            (
                (dataframe['macd'] < dataframe['macdsignal']) &
                (dataframe['macd'].shift(1) >= dataframe['macdsignal'].shift(1)) &
                (dataframe['cci'] >= self.sell_cci.value) &
                (dataframe['volume'] > 0)  # Make sure there is volume.
            ),
            'exit_long'] = 1

        return dataframe
