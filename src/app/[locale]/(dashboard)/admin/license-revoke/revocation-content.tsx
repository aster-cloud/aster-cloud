// RevocationContent — SaaS license revocation page composition。
//
// 设计意图：
//   - current manifest、new revocation form、active revocation table 三段分离
//   - 写入后用 router.refresh() 回到 server truth，避免客户端维护影子状态

'use client';

import { useTranslations } from 'next-intl';
import { CurrentPublicationCard } from './components/current-publication';
import { NewRevocationForm } from './components/new-revocation-form';
import { RevokedLicensesTable } from './components/revoked-licenses-table';

export type RevocationReason =
  | 'non-payment'
  | 'security'
  | 'renewal-superseded'
  | 'contract-terminated'
  | 'fraud';

export interface RevokedLicense {
  licenseId: string;
  reason: RevocationReason;
  revokedAt: string;
  revokedBy: string;
  notes?: string;
  customerRef?: string;
  undoExpiresAt?: string;
}

export interface CurrentPublication {
  version: number | string;
  publishedAt: string;
  validUntil: string;
  revokedCount: number;
}

interface Props {
  initialRevoked: RevokedLicense[];
  currentPublication: CurrentPublication | null;
}

export function RevocationContent({
  initialRevoked,
  currentPublication,
}: Props) {
  const t = useTranslations('admin.licenseRevoke');

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-fg">{t('title')}</h1>
        <p className="mt-1 text-sm text-fg-muted">{t('subtitle')}</p>
      </header>

      <CurrentPublicationCard publication={currentPublication} />
      <NewRevocationForm />
      <RevokedLicensesTable revoked={initialRevoked} />
    </div>
  );
}
