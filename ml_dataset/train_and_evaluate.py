import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, classification_report
import json

# Load data
features = pd.read_csv('features.csv')
labels = pd.read_csv('labels.csv')

# Merge on date
data = features.merge(labels, on='date')
data = data.sort_values('date').reset_index(drop=True)

# Load equity curves for return calculation
equity_ma = pd.read_csv('equity_ma_2020_2025.csv', parse_dates=['date'])
equity_btc = pd.read_csv('equity_btc_2020_2025.csv', parse_dates=['date'])
equity_ma.set_index('date', inplace=True)
equity_btc.set_index('date', inplace=True)

# Ensure data['date'] is datetime
data['date'] = pd.to_datetime(data['date'])
data.set_index('date', inplace=True)

# Align equity with data index
data['equity_ma'] = equity_ma['total_equity']
data['equity_btc'] = equity_btc['total_equity']

# Drop rows with missing equity or label -1
data = data.dropna(subset=['equity_ma', 'equity_btc', 'label'])
data = data[data['label'] != -1]

# Feature columns
feature_cols = [c for c in data.columns if c not in ['label', 'equity_ma', 'equity_btc']]

# Time-based train/test split: train up to 2023, test 2024-2025
train = data[data.index.year <= 2023]
test = data[data.index.year >= 2024]

if len(test) == 0:
    # maybe small dataset, use 70/30 split sequentially
    split_idx = int(len(data) * 0.7)
    train = data.iloc[:split_idx]
    test = data.iloc[split_idx:]

X_train = train[feature_cols]
y_train = train['label']
X_test = test[feature_cols]
y_test = test['label']

# Train Random Forest
clf = RandomForestClassifier(n_estimators=100, max_depth=5, random_state=42, class_weight='balanced')
clf.fit(X_train, y_train)

y_pred = clf.predict(X_test)
acc = accuracy_score(y_test, y_pred)
print("Test Accuracy:", acc)
print(classification_report(y_test, y_pred, target_names=['MA','BTC','Cash']))

# Feature importances
importances = pd.Series(clf.feature_importances_, index=feature_cols).sort_values(ascending=False)
print("\nTop feature importances:")
print(importances.head(10))

# Simulate ML strategy performance on test set
# For each test date, we allocate to the predicted strategy for the next forward period.
# We'll compute the return of that strategy between t and t+forwardBars using equity curves.
# We need forward bars count; we can approximate by using consecutive dates. Since our data is weekly, forward horizon is 20 bars ~ 5 months? Actually 20 4h bars ~ 5 days. But our prediction frequency is weekly, so forward period overlaps. We'll simplify: use the next available equity after the prediction date that corresponds to the forward horizon. However, our dataset labels already reflect which strategy performed best over forwardBars. For simulation, we can simply use the label as correct action and assume we achieve the return of that strategy over the period. But to compute cumulative equity, we need to know the return of the chosen strategy over the next period. We can compute from equity: return = (equity_future - equity_now) / equity_now. But we must ensure the future date is exactly date+forwardBars. In our dataset generation, we used forwardBars=20 and used the equity.csv which is daily? Actually equity is per day (since simulation advances day by day). The equity log is daily with totalEquity at end of day. Our prediction dates are weekly (Mondays). The forwardBars=20 bars = 20 * 4h = about 5 days, which is less than a week. That might cause misalignment. But for demonstration, we'll just use the label's strategy and assume we hold for 1 week (till next prediction). Or compute weekly returns from the equity curves (by resampling to weekly). Let's keep it simple: we'll compute weekly returns from equity curves and then apply the predicted label to choose which strategy's weekly return to take.

# Build a test set with date, predicted label, and actual next-week returns for MA and BTC
# Resample equity to weekly (using Monday dates)
equity_ma_weekly = equity_ma.resample('W-MON').last()  # week ending Monday? Actually we want aligned to our prediction dates (which are Mondays). Use reindex.
equity_btc_weekly = equity_btc.resample('W-MON').last()

# Compute weekly returns
ma_weekly_ret = equity_ma_weekly['total_equity'].pct_change().shift(-1)  # return over next week
btc_weekly_ret = equity_btc_weekly['total_equity'].pct_change().shift(-1)

# Align to test dates
test_dates = test.index
ma_ret = ma_weekly_ret.reindex(test_dates).values
btc_ret = btc_weekly_ret.reindex(test_dates).values

# Determine actual best strategy per week based on returns
actual_best = np.argmax(np.vstack([ma_ret, btc_ret]), axis=0)  # 0=MA,1=BTC

# Predictions from model
preds = clf.predict(X_test)

# ML strategy return: take return of predicted strategy
chosen_ret = np.where(preds == 0, ma_ret, np.where(preds == 1, btc_ret, 0))
# Benchmark: always MA, always BTC
always_ma_ret = ma_ret
always_btc_ret = btc_ret

# Compute cumulative returns (assuming start equity=1)
cum_ml = np.cumprod(1 + chosen_ret)
cum_ma = np.cumprod(1 + always_ma_ret)
cum_btc = np.cumprod(1 + always_btc_ret)

print("\nCumulative returns on test period:")
print(f"ML strategy: {cum_ml[-1]:.2f}x")
print(f"Always MA:   {cum_ma[-1]:.2f}x")
print(f"Always BTC:  {cum_btc[-1]:.2f}x")

# Save predictions for inspection
test_results = pd.DataFrame({
    'date': test_dates,
    'predicted': preds,
    'actual_best': actual_best,
    'ma_return': ma_ret,
    'btc_return': btc_ret,
    'ml_return': chosen_ret
})
test_results.to_csv('ml_predictions.csv', index=False)
print("\nPredictions saved to ml_predictions.csv")

# Save model
import joblib
joblib.dump(clf, 'model.pkl')
print("Model saved to model.pkl")
