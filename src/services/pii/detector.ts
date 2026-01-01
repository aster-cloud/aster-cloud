export type PIIType =
  | 'email'
  | 'phone'
  | 'ssn'
  | 'address'
  | 'name'
  | 'dob'
  | 'credit_card'
  | 'passport'
  | 'driver_license'
  | 'bank_account';

export interface PIILocation {
  type: 'pattern' | 'keyword';
  match: string;
  index: number;
}

export interface PIIDetectionResult {
  hasPII: boolean;
  detectedTypes: PIIType[];
  locations: PIILocation[];
  riskLevel: 'low' | 'medium' | 'high';
}

const PII_PATTERNS: Array<{ type: PIIType; pattern: RegExp }> = [
  { type: 'email', pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  { type: 'phone', pattern: /\b(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?){2}\d{4}\b/g },
  { type: 'ssn', pattern: /\b\d{3}-\d{2}-\d{4}\b/g },
  { type: 'email', pattern: /\b(email|mailto)\b/gi },
  { type: 'phone', pattern: /\b(phone|mobile|tel)\b/gi },
  { type: 'ssn', pattern: /\b(ssn|social.?security)\b/gi },
  { type: 'address', pattern: /\b(address|street|city|zip)\b/gi },
  { type: 'name', pattern: /\b(first.?name|last.?name|full.?name)\b/gi },
  { type: 'dob', pattern: /\b(date.?of.?birth|dob|birthday)\b/gi },
  { type: 'credit_card', pattern: /\b(credit.?card|card.?number)\b/gi },
  { type: 'passport', pattern: /\bpassport\b/gi },
  { type: 'driver_license', pattern: /\b(driver.?licen[cs]e|dl.?number)\b/gi },
  { type: 'bank_account', pattern: /\b(bank.?account|account.?number|iban)\b/gi },
];

const HIGH_RISK: PIIType[] = ['ssn', 'credit_card'];
const MEDIUM_RISK: PIIType[] = ['bank_account', 'passport', 'driver_license'];

export function detectPII(text: string): PIIDetectionResult {
  const detected = new Set<PIIType>();
  const locations: PIILocation[] = [];
  const content = text || '';

  PII_PATTERNS.forEach(({ type, pattern }) => {
    if (detected.has(type)) {
      return;
    }

    const regex = new RegExp(pattern.source, pattern.flags);
    const match = regex.exec(content);
    if (match) {
      detected.add(type);
      locations.push({
        type: 'pattern',
        match: match[0],
        index: match.index ?? 0,
      });
    }
  });

  const detectedTypes = Array.from(detected);
  let riskLevel: 'low' | 'medium' | 'high' = 'low';

  if (detectedTypes.some((type) => HIGH_RISK.includes(type))) {
    riskLevel = 'high';
  } else if (detectedTypes.some((type) => MEDIUM_RISK.includes(type))) {
    riskLevel = 'medium';
  }

  return {
    hasPII: detectedTypes.length > 0,
    detectedTypes,
    locations,
    riskLevel,
  };
}
