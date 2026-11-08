import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { compareScenarios, simulate, type ScenarioModel } from '@whatif/engine';
import { NumberInput } from '../src/components/ui/Form';
import { Button, SourceTag } from '../src/components/ui';
import { LineChart } from '../src/components/charts/LineChart';
import { Tornado } from '../src/components/charts/Tornado';
import { keyDifferences } from '../src/pages/workspace/CompareTab';
import { money, parseNumberInput } from '../src/lib/format';

describe('number parsing', () => {
  it('accepts the ways people type amounts', () => {
    expect(parseNumberInput('12,500')).toBe(12_500);
    expect(parseNumberInput('12 500')).toBe(12_500);
    expect(parseNumberInput('2.5k')).toBe(2_500);
    expect(parseNumberInput('1.2m')).toBe(1_200_000);
    expect(parseNumberInput('1.234,56')).toBeCloseTo(1234.56);
    expect(parseNumberInput('2,5')).toBe(2.5);
    expect(parseNumberInput('-300')).toBe(-300);
    expect(parseNumberInput('')).toBeNull();
    expect(Number.isNaN(parseNumberInput('abc'))).toBe(true);
  });

  it('parses text formatted in the active locale', () => {
    expect(parseNumberInput('62.000', 'de-DE')).toBe(62_000);
    expect(parseNumberInput('1.234,5', 'de-DE')).toBe(1234.5);
    expect(parseNumberInput('2,5', 'de-DE')).toBe(2.5);
    expect(parseNumberInput('62,000', 'en-US')).toBe(62_000);
  });

  it('formats money compactly only when it helps', () => {
    expect(money(851.7, 'EUR', { compact: true })).toBe('€852');
    expect(money(134_777, 'EUR', { compact: true })).toBe('€134.8K');
    expect(money(null, 'EUR')).toBe('—');
  });
});

describe('NumberInput', () => {
  it('commits parsed values while typing', () => {
    const onChange = vi.fn();
    render(<NumberInput ariaLabel="Salary" value={null} onChange={onChange} suffix="EUR" />);
    const input = screen.getByLabelText('Salary');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '55k' } });
    expect(onChange).toHaveBeenLastCalledWith(55_000);
    expect(screen.getByText('EUR')).toBeInTheDocument();
  });

  it('clamps to bounds on blur and flags invalid text', () => {
    const onChange = vi.fn();
    render(<NumberInput ariaLabel="Rate" value={5} onChange={onChange} min={0} max={100} />);
    const input = screen.getByLabelText('Rate');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '250' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith(100);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'lots' } });
    fireEvent.blur(input);
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('replaces an existing value instead of appending to it', () => {
    const onChange = vi.fn();
    render(<NumberInput ariaLabel="Income" value={62_000} onChange={onChange} />);
    const input = screen.getByLabelText('Income') as HTMLInputElement;
    expect(input.value).toBe('62,000');
    fireEvent.focus(input);
    // Focusing must not rewrite the text (that raced with select-all and appended digits).
    expect(input.value).toBe('62,000');
    fireEvent.change(input, { target: { value: '90000' } });
    expect(onChange).toHaveBeenLastCalledWith(90_000);
  });

  it('reports null when cleared', () => {
    const onChange = vi.fn();
    render(<NumberInput ariaLabel="Cash" value={100} onChange={onChange} />);
    const input = screen.getByLabelText('Cash');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});

describe('Button and tags', () => {
  it('disables while loading and keeps an accessible name for icon buttons', () => {
    render(
      <>
        <Button loading>Save</Button>
        <Button iconOnly icon={<span />}>
          Delete scenario
        </Button>
      </>,
    );
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete scenario' })).toBeInTheDocument();
  });

  it('labels value sources in words, not only colour', () => {
    render(
      <>
        <SourceTag source="ai" />
        <SourceTag source="system" />
        <SourceTag source="user" missing />
      </>,
    );
    expect(screen.getByText('AI estimate')).toBeInTheDocument();
    expect(screen.getByText('Assumption')).toBeInTheDocument();
    expect(screen.getByText('Needs input')).toBeInTheDocument();
  });
});

describe('charts', () => {
  it('renders lines with a legend for several series', () => {
    render(
      <LineChart
        ariaLabel="Net worth"
        xFormat={String}
        yFormat={String}
        series={[
          { id: 'a', label: 'Stay', color: 'red', points: [{ x: 0, y: 0 }, { x: 1, y: 10 }] },
          { id: 'b', label: 'Move', color: 'blue', points: [{ x: 0, y: 0 }, { x: 1, y: 20 }] },
        ]}
      />,
    );
    expect(screen.getByRole('img', { name: 'Net worth' })).toBeInTheDocument();
    const legend = screen.getByRole('list', { name: 'Legend' });
    expect(legend).toHaveTextContent('Stay');
    expect(legend).toHaveTextContent('Move');
  });

  it('renders a tornado row per sensitivity item', () => {
    const r = simulate({
      startDate: '2027-01',
      horizonYears: 5,
      currency: 'EUR',
      variables: { grossAnnualIncome: { value: 50_000, low: 40_000, high: 60_000, source: 'user' }, livingCostMonthly: { value: 1_500, source: 'user' } },
      flows: [],
    });
    render(<Tornado items={r.sensitivity} base={r.expected.summary.finalNetWorth} format={(v) => String(Math.round(v))} formatInput={(_, v) => String(v)} />);
    expect(screen.getByText('Gross annual salary')).toBeInTheDocument();
  });
});

describe('key differences', () => {
  it('describes the comparison using only computed numbers', () => {
    const m = (income: number, extra: Partial<ScenarioModel> = {}): ScenarioModel => ({
      startDate: '2027-01',
      horizonYears: 5,
      currency: 'EUR',
      variables: { startingCash: { value: 10_000, source: 'user' }, grossAnnualIncome: { value: income, source: 'user' }, livingCostMonthly: { value: 1_500, source: 'user' } },
      flows: [],
      ...extra,
    });
    const cmp = compareScenarios(
      [
        { id: 'a', name: 'Stay', isBaseline: true, result: simulate(m(30_000)), exchangeRateToBase: 1 },
        { id: 'b', name: 'Move', isBaseline: false, result: simulate(m(60_000, { flows: [{ id: 'x', kind: 'one_time_expense', label: 'Move', amount: 5_000, startMonth: 0, source: 'user' }] })), exchangeRateToBase: 1 },
      ],
      'EUR',
    );
    const lines = keyDifferences(cmp, 'EUR');
    expect(lines[0]).toMatch(/^Move ends €[\d,]+ ahead of Stay/);
    expect(lines.some((l) => l.includes('needs the most cash upfront: €5,000'))).toBe(true);
  });
});
