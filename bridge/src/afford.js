// Verdict for "can I afford this?" against one category's weekly position (cents).
export function affordCheck({ amount, position }) {
  const afterWeek = position.remainingThisWeek - amount;
  const afterMonth = position.monthRemaining - amount;
  let verdict;
  if (afterMonth < 0) verdict = 'no';
  else if (afterWeek < 0) verdict = 'tight';
  else verdict = 'yes';
  return {
    verdict,
    amount,
    remainingThisWeekAfter: afterWeek,
    monthRemainingAfter: afterMonth,
    reason:
      verdict === 'no'
        ? 'Over the category balance for the month'
        : verdict === 'tight'
          ? "Over this week's share, but within the month's balance"
          : "Within this week's share",
  };
}
