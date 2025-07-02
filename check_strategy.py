import sys
sys.path.append('c:\\Users\\HP1\\Music\\botmoon-backend\\user_data\\strategies')

try:
    from FixedRiskRewardLoss import FixedRiskRewardLoss
    print("Successfully imported FixedRiskRewardLoss")
    # Attempt to instantiate the class (if it has a simple constructor)
    # This might fail if it requires Freqtrade specific context
    try:
        strategy_instance = FixedRiskRewardLoss()
        print("Successfully instantiated FixedRiskRewardLoss")
    except Exception as e:
        print(f"Error instantiating FixedRiskRewardLoss: {e}")

except ImportError as e:
    print(f"ImportError: {e}")
except Exception as e:
    print(f"An unexpected error occurred: {e}")