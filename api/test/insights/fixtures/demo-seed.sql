-- SpendVault demo data: one user with ~6 months of realistic INR spending,
-- dated relative to current_date so it always looks "live".
-- Login: demo@spendvault.local / demo-password-123
-- Re-runnable: deletes the demo user first (everything cascades).
--   docker exec -i api-postgres-1 psql -U spendvault < api/test/insights/fixtures/demo-seed.sql
--
-- What it should trigger:
--   category_spike  food delivery in the last complete month (~2.5x normal)
--   price_hike      Netflix ₹649 → ₹799 since last month
--   fee             late fee ₹750 + GST ₹135 last month
--   duplicate       Amazon ₹2,499 charged twice, 4–5 days ago
--   large_new_merchant  Croma ₹54,990, 3 days ago
--   savings tips    YouTube Premium + Spotify overlap, Netflix hike, late fee, food delivery nudge, card tip
-- Card bill payments (both sides), salary, rent transfers and investments must NOT count as spend.
-- One alert-sourced Swiggy row is superseded by its statement line (excluded everywhere).

BEGIN;
DELETE FROM users WHERE email = 'demo@spendvault.local';

DO $$
DECLARE
  uid uuid;
  card uuid;
  bank uuid;
  m date;          -- first day of the month being generated
  k int;           -- months back (6 .. 0)
  i int;
  d date;
  stmt_id uuid;
  amt numeric;
  hike boolean;
BEGIN
  INSERT INTO users (email, password_hash, display_name, inbound_token, base_currency)
  VALUES ('demo@spendvault.local', '$2a$10$If/gjriw9ao1sI/mA191bO14m68ev92sRoeiZycnfw/gCuso8Driu', 'Demo User', 'demo4spendvlt', 'INR')
  RETURNING id INTO uid;

  INSERT INTO accounts (user_id, institution, kind, last4, currency) VALUES (uid, 'hdfc', 'credit_card', '4321', 'INR') RETURNING id INTO card;
  INSERT INTO accounts (user_id, institution, kind, last4, label, currency) VALUES (uid, 'icici', 'bank', '7788', 'Salary account', 'INR') RETURNING id INTO bank;

  -- helper: tx(account, date, desc, merchant, category, amount, direction)
  CREATE TEMP TABLE IF NOT EXISTS _seed (account_id uuid, posted_on date, description_raw text, merchant text, category text, amount numeric, direction text, source_kind text DEFAULT 'statement') ON COMMIT DROP;

  FOR k IN REVERSE 6..0 LOOP
    m := (date_trunc('month', current_date) - make_interval(months => k))::date;
    hike := k <= 1;

    -- Income + fixed costs (bank)
    INSERT INTO _seed VALUES (bank, m, 'NEFT CR ACME TECHNOLOGIES SALARY', 'Income/refund', 'income', 150000, 'credit');
    INSERT INTO _seed VALUES (bank, m + 1, 'UPI/NOBROKER RENT PAYMENT', 'Rent/housing', 'rent', 32000, 'debit');
    INSERT INTO _seed VALUES (bank, m + 6, 'ZERODHA BROKING SIP', 'Investment', 'investments', 15000, 'debit');
    INSERT INTO _seed VALUES (bank, m + 17, 'HDFC CREDIT CARD CC PAYMENT', 'Card bill payment', 'card_payment', 38000 + k * 500, 'debit');
    INSERT INTO _seed VALUES (card, m + 17, 'PAYMENT RECEIVED - THANK YOU', 'Card bill payment', 'card_payment', 38000 + k * 500, 'credit');
    INSERT INTO _seed VALUES (bank, m + 9, 'BESCOM ELECTRICITY BILL BBPS', 'Utility bill', 'utilities', 1800 + (k % 3) * 150, 'debit');

    -- Subscriptions (card)
    INSERT INTO _seed VALUES (card, m + 2, 'SPOTIFY INDIA', 'Spotify', 'subscriptions', 119, 'debit');
    INSERT INTO _seed VALUES (card, m + 4, 'NETFLIX.COM MUMBAI', 'Netflix', 'subscriptions', CASE WHEN hike THEN 799 ELSE 649 END, 'debit');
    INSERT INTO _seed VALUES (card, m + 7, 'GOOGLE *YOUTUBE PREMIUM', 'YouTube Premium', 'subscriptions', 149, 'debit');
    INSERT INTO _seed VALUES (card, m + 11, 'AIRTEL POSTPAID BILL', 'Telecom/internet', 'telecom', 999, 'debit');

    -- Food delivery: ~14 orders a month, ~35 in the spike month (k = 1)
    FOR i IN 1..(CASE WHEN k = 1 THEN 35 ELSE 14 END) LOOP
      d := m + ((i * 2) % 28);
      amt := 380 + ((i * 97 + k * 31) % 320);
      INSERT INTO _seed VALUES (card, d, 'SWIGGY BANGALORE', 'Swiggy', 'food_delivery', amt, 'debit');
    END LOOP;
    INSERT INTO _seed VALUES (card, m + 13, 'ZOMATO ORDER', 'Zomato/Blinkit', 'food_delivery', 640, 'debit');

    -- Groceries weekly, cabs, dining, shopping
    FOR i IN 0..3 LOOP
      INSERT INTO _seed VALUES (card, m + 2 + i * 7, 'BIGBASKET BBNOW', 'BigBasket', 'groceries', 1650 + ((i * 211 + k * 53) % 600), 'debit');
      INSERT INTO _seed VALUES (card, m + 3 + i * 7, 'UBER INDIA TRIP', 'Cab ride', 'transport', 240 + ((i * 71 + k * 13) % 260), 'debit');
    END LOOP;
    INSERT INTO _seed VALUES (card, m + 15, 'THIRD WAVE COFFEE', 'Third Wave Coffee', 'dining', 520, 'debit');
    INSERT INTO _seed VALUES (card, m + 22, 'TOIT BREWPUB RESTAURANT', 'Toit Brewpub', 'dining', 2400 + k * 100, 'debit');
    INSERT INTO _seed VALUES (card, m + 10, 'AMAZON PAY IN ECOM', 'Amazon', 'shopping', 1800 + k * 220, 'debit');
    INSERT INTO _seed VALUES (card, m + 24, 'MYNTRA DESIGNS', 'Myntra', 'shopping', 1400 + k * 130, 'debit');
    INSERT INTO _seed VALUES (card, m + 14, 'INDIAN OIL PETROL PUMP', 'Fuel station', 'fuel', 2500, 'debit');
  END LOOP;

  -- Last complete month: late fee + GST on the card
  m := (date_trunc('month', current_date) - interval '1 month')::date;
  INSERT INTO _seed VALUES (card, m + 19, 'LATE PAYMENT FEE', 'Bank fee/charge', 'fees_charges', 750, 'debit');
  INSERT INTO _seed VALUES (card, m + 19, 'IGST ON LATE PAYMENT FEE', 'Bank fee/charge', 'fees_charges', 135, 'debit');
  -- An Amazon refund (nets against shopping)
  INSERT INTO _seed VALUES (card, m + 12, 'AMAZON REFUND', 'Amazon', 'income', 799, 'credit');

  -- Recent: duplicate charge + big new merchant
  INSERT INTO _seed VALUES (card, current_date - 5, 'AMAZON PAY IN ECOM', 'Amazon', 'shopping', 2499, 'debit');
  INSERT INTO _seed VALUES (card, current_date - 4, 'AMAZON PAY IN ECOM', 'Amazon', 'shopping', 2499, 'debit');
  INSERT INTO _seed VALUES (card, current_date - 3, 'CROMA RETAIL BANGALORE', 'Croma', 'shopping', 54990, 'debit');

  DELETE FROM _seed WHERE posted_on > current_date;

  INSERT INTO transactions (user_id, account_id, posted_on, description_raw, merchant, category, amount, direction, currency, source_kind, fingerprint)
  SELECT uid, account_id, posted_on, description_raw, merchant, category, amount, direction, 'INR', source_kind, md5(random()::text || clock_timestamp()::text)
  FROM _seed;

  -- An alert-sourced row later matched by its statement line: superseded, excluded everywhere.
  SELECT id INTO stmt_id FROM transactions WHERE user_id = uid AND merchant = 'Swiggy' ORDER BY posted_on DESC LIMIT 1;
  INSERT INTO transactions (user_id, account_id, posted_on, description_raw, merchant, category, amount, direction, currency, source_kind, fingerprint, superseded_by)
  SELECT uid, card, posted_on, 'Rs.' || amount || ' spent on HDFC Card at SWIGGY', 'Swiggy', 'food_delivery', amount, 'debit', 'INR', 'alert', md5(random()::text), id
  FROM transactions WHERE id = stmt_id;
END $$;
COMMIT;
