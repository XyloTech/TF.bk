from freqtrade.strategy import IStrategy

class TestStrategy(IStrategy):
    timeframe = '5m'
    minimal_roi = {"0": 0.01}
    stoploss = -0.1

    def populate_indicators(self, dataframe, metadata):
        return dataframe

    def populate_entry_trend(self, dataframe, metadata):
        dataframe.loc[(dataframe['volume'] > 0), 'enter_long'] = 1
        return dataframe

    def populate_exit_trend(self, dataframe, metadata):
        dataframe.loc[(dataframe['volume'] > 0), 'exit_long'] = 1
        return dataframe