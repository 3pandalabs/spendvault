// "How to cancel" for common US subscriptions. Pure.
//
// Only the service's OWN account or help pages (checked 2026-11-27). We never
// cancel anything for the user; the Subscriptions page just links here.
// Patterns run against "<merchant> <raw description>" lowercased, first match
// wins (specific services before their parent company).

export type CancelInfo = { name: string; url: string; note?: string };

const LINKS: Array<{ match: RegExp } & CancelInfo> = [
  { match: /netflix/, name: "Netflix", url: "https://www.netflix.com/cancelplan" },
  { match: /spotify/, name: "Spotify", url: "https://www.spotify.com/account/subscription/" },
  { match: /hulu/, name: "Hulu", url: "https://secure.hulu.com/account" },
  { match: /disney\s*\+|disney\s*plus|disneyplus/, name: "Disney+", url: "https://www.disneyplus.com/account" },
  { match: /\bhbo\s*max\b|\bmax\.com\b|\bhbomax\b|^max\b/, name: "Max", url: "https://help.max.com/" },
  { match: /kindle\s*unl/, name: "Kindle Unlimited", url: "https://www.amazon.com/kindle-dbs/ku/ku-central" },
  { match: /audible/, name: "Audible", url: "https://www.audible.com/account/overview" },
  { match: /amazon\s*prime|prime\s*video|primevideo|amzn\s*prime|prime\s*membership/, name: "Amazon Prime", url: "https://www.amazon.com/mc" },
  {
    match: /apple\.com\/bill|itunes|apple\s*(services|music|tv|one|arcade)|icloud/,
    name: "Apple subscriptions",
    url: "https://support.apple.com/en-us/118428",
    note: "Apple bills App Store, iCloud+, Apple Music and Apple TV+ together; cancel each in Settings > your name > Subscriptions.",
  },
  { match: /youtube/, name: "YouTube Premium / TV", url: "https://www.youtube.com/paid_memberships" },
  { match: /google\s*(\*|play|one|storage)/, name: "Google Play subscriptions", url: "https://play.google.com/store/account/subscriptions" },
  { match: /peacock/, name: "Peacock", url: "https://www.peacocktv.com/account" },
  { match: /paramount/, name: "Paramount+", url: "https://www.paramountplus.com/account/" },
  { match: /adobe/, name: "Adobe", url: "https://account.adobe.com/plans" },
  { match: /microsoft|msft|office\s*365|xbox/, name: "Microsoft 365 / Xbox", url: "https://account.microsoft.com/services" },
  { match: /dropbox/, name: "Dropbox", url: "https://www.dropbox.com/account/plan" },
  { match: /nytimes|ny\s*times|new\s*york\s*times/, name: "The New York Times", url: "https://help.nytimes.com/" },
  { match: /wsj|wall\s*street\s*journal|dow\s*jones/, name: "The Wall Street Journal", url: "https://customercenter.wsj.com/" },
  {
    match: /planet\s*fitness|pf\s*club/,
    name: "Planet Fitness",
    url: "https://www.planetfitness.com/",
    note: "Planet Fitness cancellations go through your home club (some states allow online); check your club's page.",
  },
  { match: /\bsling\b/, name: "Sling TV", url: "https://www.sling.com/account" },
  { match: /sirius\s*xm|siriusxm/, name: "SiriusXM", url: "https://www.siriusxm.com/" },
  { match: /dashpass|doordash/, name: "DoorDash DashPass", url: "https://www.doordash.com/dashpass/" },
  { match: /walmart\s*\+|walmart\s*plus|wmt\s*plus/, name: "Walmart+", url: "https://www.walmart.com/plus/account" },
  { match: /linkedin/, name: "LinkedIn Premium", url: "https://www.linkedin.com/premium/manage/" },
  { match: /duolingo/, name: "Duolingo", url: "https://www.duolingo.com/settings/subscription" },
  { match: /instacart/, name: "Instacart+", url: "https://www.instacart.com/store/account/instacart-plus" },
  { match: /uber\s*one/, name: "Uber One", url: "https://www.uber.com/us/en/u/uber-one/" },
];

export const CANCEL_LINK_COUNT = LINKS.length;

export function cancelInfoFor(text: string | null | undefined): CancelInfo | null {
  const s = (text ?? "").toLowerCase();
  if (!s.trim()) return null;
  const hit = LINKS.find((l) => l.match.test(s));
  return hit ? { name: hit.name, url: hit.url, ...(hit.note ? { note: hit.note } : {}) } : null;
}
