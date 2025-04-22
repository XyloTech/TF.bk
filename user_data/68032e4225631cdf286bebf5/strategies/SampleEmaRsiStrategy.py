# --- Do not remove these libs ---
from freqtrade.strategy import IStrategy, merge_informative_pair
from pandas import DataFrame
import talib.abstract as ta
import freqtrade.vendor.qtpylib.indicators as qtpylib

# --------------------------------

class SampleEmaRsiStrategy(IStrategy):
    """
    Sample Freqtrade Strategy
    ------------------------------------
    Author: Your Name/Source
    Version: 1.0

    Description:
    A simple strategy based on EMA crosses and RSI filtering.
    * Buys when the short EMA crosses above the long EMA and RSI is below a threshold.
    * Sells when the short EMA crosses below the long EMA.

    How to use it?
    > freqtrade trade --strategy SampleEmaRsiStrategy
    """

    # Strategy interface version - Required. Don't change.
    INTERFACE_VERSION = 2

    # --- Strategy Configuration ---

    # Minimal ROI designed for the strategy.
    # Adjust based on testing and market conditions.
    # Example: Sell after 5% profit is reached.
    minimal_roi = {
        "0": 0.05  # Sell anytime profit reaches 5%
        # "30": 0.03 # Example: Sell after 30 mins if profit is 3%
        # "60": 0.01 # Example: Sell after 60 mins if profit is 1%
    }

    # Stoploss: Set a fixed maximum loss per trade.
    # Example: Sell if price drops 10% below the buy price.
    stoploss = -0.10  # 10% stop loss

    # Trailing stoploss: Optional, follows price upwards.
    # trailing_stop = True
    # trailing_stop_positive = 0.01  # Trail by 1% once profit reaches...
    # trailing_stop_positive_offset = 0.02  # ... 2% profit.
    # trailing_only_offset_is_reached = True # Only enable trailing stop when offset is reached

    # Timeframe: The candle size the strategy operates on.
    # Common values: '1m', '5m', '15m', '30m', '1h', '4h', '1d'
    timeframe = '1h'

    # --- Indicator Configuration ---
    # Define periods for indicators
    ema_short_period = 10
    ema_long_period = 25
    rsi_period = 14
    rsi_buy_threshold = 65 # Avoid buying if RSI is above this value

    # --- Informative Pairs ---
    # Use this section if you need indicators from different timeframes or pairs
    # Example: Use 4h timeframe for trend confirmation
    # informative_timeframe = '4h'
    # informative_pairs = [] # Add pairs if needed for cross-pair analysis

    # --- Strategy Logic Methods ---

    def populate_indicators(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        """
        Adds several different TA indicators to the given DataFrame.

        Args:
            dataframe (DataFrame): Raw data from the exchange and stored into pandas DataFrame
            metadata (dict): Pair metadata dictionary containing pair info

        Returns:
            DataFrame: DataFrame with new indicators added
        """
        # --- Exponential Moving Averages (EMA) ---
        dataframe[f'ema_short'] = ta.EMA(dataframe, timeperiod=self.ema_short_period)
        dataframe[f'ema_long'] = ta.EMA(dataframe, timeperiod=self.ema_long_period)

        # --- Relative Strength Index (RSI) ---
        dataframe['rsi'] = ta.RSI(dataframe, timeperiod=self.rsi_period)

        # --- Add Informative Indicators (Example) ---
        # if self.informative_timeframe:
        #     informative = self.dp.get_pair_dataframe(pair=metadata['pair'], timeframe=self.informative_timeframe)
        #     # Calculate indicator on informative timeframe (e.g., EMA 50 on 4h)
        #     informative['inf_ema_50'] = ta.EMA(informative, timeperiod=50)
        #     # Merge informative indicators using merge_informative_pair
        #     dataframe = merge_informative_pair(dataframe, informative, self.timeframe, self.informative_timeframe, ffill=True)

        return dataframe

    def populate_buy_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        """
        Based on TA indicators, populates the 'buy' signal column for the given dataframe.

        Args:
            dataframe (DataFrame): DataFrame with indicators
            metadata (dict): Pair metadata

        Returns:
            DataFrame: DataFrame with buy column
        """
        conditions = []

        # --- Buy Condition 1: EMA Crossover ---
        conditions.append(
            qtpylib.crossed_above(
                dataframe[f'ema_short'],
                dataframe[f'ema_long']
            )
        )

        # --- Buy Condition 2: RSI Filter ---
        # Only buy if RSI is below the overbought threshold
        conditions.append(dataframe['rsi'] < self.rsi_buy_threshold)

        # --- Optional: Trend Confirmation (using informative example) ---
        # if self.informative_timeframe:
        #     conditions.append(dataframe['close'] > dataframe[f'inf_ema_50_{self.informative_timeframe}']) # Price above 4h EMA 50

        # --- Final Buy Signal ---
        # Build the final signal based on conditions
        if conditions:
            dataframe.loc[
                # Combine all conditions using logical AND (&)
                (
                    # Reduce applies the & operator iteratively to the list of conditions
                    # This requires importing functools: from functools import reduce
                    # Alternatively, chain them manually if you have few conditions:
                    conditions[0] & conditions[1] # & conditions[2] ...
                ),
                'buy'] = 1
        else:
            # Default to no buy signal if no conditions are defined
            dataframe['buy'] = 0

        return dataframe

    def populate_sell_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        """
        Based on TA indicators, populates the 'sell' signal column for the given dataframe.

        Args:
            dataframe (DataFrame): DataFrame with indicators
            metadata (dict): Pair metadata

        Returns:
            DataFrame: DataFrame with sell column
        """
        conditions = []

        # --- Sell Condition 1: EMA Crossunder ---
        conditions.append(
            qtpylib.crossed_below(
                dataframe[f'ema_short'],
                dataframe[f'ema_long']
            )
        )

        # --- Optional Sell Condition 2: RSI Overbought ---
        # Example: Sell if RSI crosses above 75 (could be an exit signal)
        # conditions.append(qtpylib.crossed_above(dataframe['rsi'], 75))

        # --- Final Sell Signal ---
        if conditions:
            dataframe.loc[
                (
                    conditions[0] # Only using EMA crossunder for this example
                    # Use | for logical OR if combining multiple sell triggers
                    # e.g., conditions[0] | conditions[1]
                ),
                'sell'] = 1
        else:
            # Default to no sell signal if no conditions are defined
            dataframe['sell'] = 0

        return dataframe