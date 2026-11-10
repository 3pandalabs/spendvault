// Synthetic statement TEXT, laid out the way itemsToLines reconstructs real
// PDFs (columns separated by 2+ spaces). Names/numbers are fake.

export const HDFC_CARD = `HDFC Bank Credit Cards
Statement for HDFC Bank Regalia Credit Card
Name : RAHUL SHARMA                       Statement Date : 05/11/2026
Card No : 4893 77XX XXXX 1234             Payment Due Date : 25/11/2026
Statement Period : 06/10/2026 To 05/11/2026
Account Summary
Previous Balance    Payments/Credits    Purchases/Debits    Finance Charges    Total Dues
12,345.00           12,845.00           9,009.50            0.00               8,509.50
Total Amount Due    Minimum Amount Due    Credit Limit    Available Credit Limit
8,509.50            430.00                3,00,000.00     2,91,489.50

Domestic Transactions
Date                  Transaction Description                           Reward Points    Amount (in Rs.)
08/10/2026 22:14:05   SWIGGY BANGALORE                                  4                456.00
10/10/2026 09:01:44   AMAZON PAY INDIA PRIVATE BANGALORE                24               2,499.00
12/10/2026            NETBANKING TRANSFER (Ref# 0000123456789) PAYMENT RECEIVED - THANK YOU            12,345.00 Cr
14/10/2026 19:30:00   STARBUCKS COFFEE MUMBAI                           1                190.50
14/10/2026 19:30:00   STARBUCKS COFFEE MUMBAI                           1                190.50
21/10/2026            IGST-VPS2611234567890-RATE 18.0 -27 (Ref# 00000000)                54.00
25/10/2026            UBER INDIA SYSTEMS PVT LTD                        6                 620.50
30/10/2026            FLIPKART INTERNET PVT LTD REFUND                                    500.00 Cr
02/11/2026            NETFLIX.COM MUMBAI                                3                 649.00
03/11/2026            INDIAN OIL PETROL PUMP                            8                 4,350.00

Reward Points Summary
Opening Balance    Earned    Redeemed    Closing Balance
1,200              47        0           1,247
`;
// Debits 456 + 2499 + 190.5 + 190.5 + 54 + 620.5 + 649 + 4350 = 9009.5 ; credits 12,845
// 12,345 + 9,009.50 − 12,845 = 8,509.50

export const ICICI_CARD = `ICICI Bank
Credit Card Statement
Statement period : October 15, 2026 to November 14, 2026
Card Number 4315XXXXXXXX5678
Previous Balance ₹ 3,210.00
Total Amount due ₹ 6,147.10
Minimum Amount due ₹ 310.00
Date          SerNo.        Transaction Details                              Reward Points    Intl.# amount    Amount (in ₹)
16/10/2026    1234567890    UBER INDIA SYSTEMS PVT LTD MUMBAI IN             12                                345.60
18/10/2026    1234567891    ZOMATO LTD GURGAON IN                            20                                812.00
20/10/2026    1234567892    BBPS Payment received                            0                                 3,210.00 CR
02/11/2026    1234567893    AMAZON WEB SERVICES  SEATTLE US                  40               USD 45.00        3,989.50
10/11/2026    1234567894    BIGBASKET BANGALORE IN                           10                                1,000.00
`;
// 3,210 + (345.60+812+3,989.50+1,000 = 6,147.10) − 3,210 = 6,147.10

export const SBI_SAVINGS = `State Bank of India
Account Statement
Account Name : Mr. RAHUL SHARMA
Account Number : 00000012345678901
Statement from 1 Oct 2026 to 31 Oct 2026
Opening Balance : 50,000.00
Txn Date       Value Date     Description                                     Ref No./Cheque No.     Debit         Credit        Balance
1 Oct 2026     1 Oct 2026     BY TRANSFER-NEFT*HDFC0000001*N123456*ACME       TRANSFER FROM 1234                   85,000.00     1,35,000.00
               SOFTWARE PVT LTD SALARY
3 Oct 2026     3 Oct 2026     TO TRANSFER-UPI/DR/628812345678/SWIGGY/YESB     TRANSFER TO 4897       499.00                      1,34,501.00
5 Oct 2026     5 Oct 2026     ATM WDL-ATM CASH 1234 MG ROAD BANGALORE                                10,000.00                   1,24,501.00
10 Oct 2026    10 Oct 2026    TO TRANSFER-INB HDFC CREDIT CARD BILL                                  12,345.00                   1,12,156.00
15 Oct 2026    15 Oct 2026    BY TRANSFER-UPI/CR/628899999999/RAVI KUMAR      TRANSFER FROM 9876                   1,500.00      1,13,656.00
31 Oct 2026    31 Oct 2026    BY INT.PD                                                                            320.00        1,13,976.00
Closing Balance : 1,13,976.00
Page 1 of 1
`;
// 50,000 − (499+10,000+12,345) + (85,000+1,500+320) = 1,13,976

export const CHASE_CARD = `Chase Freedom Unlimited
Manage your account online at www.chase.com
Account Number: XXXX XXXX XXXX 4321
Opening/Closing Date 10/04/26 - 11/03/26
ACCOUNT SUMMARY
Previous Balance        $1,234.56
Payment, Credits        -$1,234.56
Purchases               +$887.35
New Balance             $887.35
ACCOUNT ACTIVITY
Date of Transaction     Merchant Name or Transaction Description           $ Amount
10/05                   STARBUCKS STORE 1234 SEATTLE WA                     5.75
10/07                   AUTOMATIC PAYMENT - THANK YOU                       -1,234.56
10/15                   AMAZON.COM*AB12CD34 AMZN.COM/BILL WA                 129.99
10/28                   WHOLEFDS MKT 10234 SEATTLE WA                        86.61
11/02                   DELTA AIR LINES ATLANTA                              665.00
`;
// 1,234.56 + 887.35 − 1,234.56 = 887.35
