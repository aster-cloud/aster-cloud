import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PolicyAliasPanel } from './policy-alias-panel';
import { extractReservedAliasSets, getLexicon } from '@/lib/aster-lexicon';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => {
    if (key === 'configuredCount') return `${values?.count ?? 0} configured`;
    if (key === 'inputLabel') return `Aliases for ${values?.kind ?? ''}`;
    return key;
  },
}));

afterEach(cleanup);

const reservedSets = extractReservedAliasSets(getLexicon('en-US'));

function renderPanel(allowStructural: boolean) {
  const onChange = vi.fn();
  render(
    <PolicyAliasPanel
      aliasSet={{}}
      locale="en-US"
      reservedSets={reservedSets}
      allowStructural={allowStructural}
      onChange={onChange}
      expanded
      onExpandedChange={vi.fn()}
    />,
  );
  return { onChange };
}

describe('PolicyAliasPanel', () => {
  it('renders arithmetic and comparison operator groups', () => {
    renderPanel(false);
    expect(screen.getByText('groupArithmetic')).toBeInTheDocument();
    expect(screen.getByText('groupComparison')).toBeInTheDocument();
    expect(screen.getByText('kinds.plus')).toBeInTheDocument();
    expect(screen.getByText('kinds.lessThan')).toBeInTheDocument();
  });

  it('locks structural aliases without entitlement', () => {
    renderPanel(false);
    expect(screen.getByText('groupStructural')).toBeInTheDocument();
    expect(screen.getByText('structuralLocked')).toBeInTheDocument();
    expect(screen.getByLabelText('Aliases for kinds.module')).toBeDisabled();
  });

  it('shows structural aliases when entitlement is present', () => {
    renderPanel(true);
    expect(screen.getByText('kinds.module')).toBeInTheDocument();
    expect(screen.getByLabelText('Aliases for kinds.module')).not.toBeDisabled();
  });

  it('shows row validation errors for unsafe single-word aliases', () => {
    render(
      <PolicyAliasPanel
        aliasSet={{ TIMES: ['multiply'] }}
        locale="en-US"
        reservedSets={reservedSets}
        allowStructural={false}
        onChange={vi.fn()}
        expanded
        onExpandedChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('必须是多词短语');
  });

  it('normalizes comma-separated input before emitting changes', () => {
    const { onChange } = renderPanel(false);
    fireEvent.change(screen.getByLabelText('Aliases for kinds.times'), {
      target: { value: 'Product Of, Times By' },
    });
    expect(onChange).toHaveBeenCalledWith({ TIMES: ['product of', 'times by'] });
  });
});
