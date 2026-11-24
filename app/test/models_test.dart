import 'package:flutter_test/flutter_test.dart';
import 'package:weekly_budget/data/models.dart';

void main() {
  test('money formats cents with separators and sign', () {
    expect(money(123456), '\$1,234.56');
    expect(money(-5), '-\$0.05');
    expect(money(0), '\$0.00');
  });

  test('parseCents accepts common inputs and rejects junk', () {
    expect(parseCents('12.5'), 1250);
    expect(parseCents('\$1,200'), 120000);
    expect(parseCents('0.07'), 7);
    expect(parseCents('abc'), isNull);
    expect(parseCents('1.234'), isNull);
    expect(parseCents(''), isNull);
  });
}
