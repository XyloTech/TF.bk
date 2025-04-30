import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
import os

def generate_summary_report(csv_file):
    if not os.path.exists(csv_file):
        print(f"❌ File not found: {csv_file}")
        return

    strategy_name = os.path.splitext(os.path.basename(csv_file))[0]

    try:
        df = pd.read_csv(csv_file, parse_dates=["date"])
        print("✅ CSV File Loaded.")
        print("📌 Columns:", list(df.columns))
    except Exception as e:
        print(f"❌ Error reading CSV: {e}")
        return

    df["mean"] = df["mean"].fillna(0)
    df["rel_mean"] = df["rel_mean"].fillna(0)
    df["count"] = df["count"].fillna(0)

    df = df.sort_values("date")
    df["cum_profit"] = df["mean"].cumsum()
    df["cum_rel_profit"] = df["rel_mean"].cumsum()

    # === Cumulative USDT Profit ===
    plt.figure(figsize=(10, 5))
    sns.lineplot(data=df, x="date", y="cum_profit")
    plt.title(f"{strategy_name} - Cumulative Profit (USDT)")
    plt.xlabel("Date")
    plt.ylabel("USDT Profit")
    plt.xticks(rotation=45)
    plt.tight_layout()
    plt.savefig(f"{strategy_name}_cumulative_profit.png")
    plt.close()

    # === Cumulative Relative Profit (%) ===
    plt.figure(figsize=(10, 5))
    sns.lineplot(data=df, x="date", y="cum_rel_profit", color="green")
    plt.title(f"{strategy_name} - Cumulative Relative Profit (%)")
    plt.xlabel("Date")
    plt.ylabel("Cumulative Rel Profit (%)")
    plt.xticks(rotation=45)
    plt.tight_layout()
    plt.savefig(f"{strategy_name}_rel_cumulative_profit.png")
    plt.close()

    # === Daily Trade Volume ===
    plt.figure(figsize=(10, 4))
    sns.barplot(x="date", y="count", data=df, color="skyblue")
    plt.title(f"{strategy_name} - Daily Trade Count")
    plt.xlabel("Date")
    plt.ylabel("Trades")
    plt.xticks(rotation=45)
    plt.tight_layout()
    plt.savefig(f"{strategy_name}_daily_trade_count.png")
    plt.close()

    # === Excel Report ===
    summary_path = f"{strategy_name}_DailySummary_Report.xlsx"
    with pd.ExcelWriter(summary_path, engine='xlsxwriter') as writer:
        df.to_excel(writer, sheet_name="Daily Summary", index=False)

        # Generate summary metrics
        summary_df = pd.DataFrame({
            "Metric": [
                "Total Days",
                "Total Trades",
                "Total Profit (USDT)",
                "Average Daily Profit (USDT)",
                "Average Daily Rel Profit (%)"
            ],
            "Value": [
                len(df),
                int(df["count"].sum()),
                round(df["mean"].sum(), 2),
                round(df["mean"].mean(), 2),
                round(df["rel_mean"].mean() * 100, 2),
            ]
        })
        summary_df.to_excel(writer, sheet_name="Summary", index=False)

    print("\n✅ Summary Report Generated!\n")
    print("📁 Files Created:")
    print(f"🧾 Excel Summary:\t{summary_path}")
    print(f"📈 Profit Curve:\t{strategy_name}_cumulative_profit.png")
    print(f"📉 Relative ROI Curve:\t{strategy_name}_rel_cumulative_profit.png")
    print(f"📊 Trade Volume:\t{strategy_name}_daily_trade_count.png")

# ========= Start Code =========
if __name__ == "__main__":
    generate_summary_report("SmartScalpingDCA_Backtest_Trades.csv")