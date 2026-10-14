// Password policy (identical copy lives in src/lib/password.ts for the browser UI;
// tests/admin-users.test.ts checks both behave the same).
export function passwordProblems(pw: string): string[] {
  const out: string[] = [];
  if (pw.length < 10) out.push('at least 10 characters');
  if (pw.length > 72) out.push('at most 72 characters');
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(pw)).length;
  if (classes < 3) out.push('at least 3 of: lowercase, uppercase, digit, symbol');
  return out;
}
