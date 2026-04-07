import { describe, expect, it } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import StraddleTracker from '@/components/StraddleTracker';

const initialData = [
  {
    strikePrice: 90,
    CE: { openInterest: 100, changeinOpenInterest: 0, totalTradedVolume: 10, lastPrice: 130 },
    PE: { openInterest: 100, changeinOpenInterest: 0, totalTradedVolume: 10, lastPrice: 70 },
  },
  {
    strikePrice: 100,
    CE: { openInterest: 100, changeinOpenInterest: 0, totalTradedVolume: 10, lastPrice: 100 },
    PE: { openInterest: 100, changeinOpenInterest: 0, totalTradedVolume: 10, lastPrice: 100 },
  },
  {
    strikePrice: 110,
    CE: { openInterest: 100, changeinOpenInterest: 0, totalTradedVolume: 10, lastPrice: 70 },
    PE: { openInterest: 100, changeinOpenInterest: 0, totalTradedVolume: 10, lastPrice: 130 },
  },
];

function expectStrikeLabel(strike: number) {
  return screen.getByText((_, node) => node?.textContent === `Strike: ${strike}`);
}

function getPnlPanel() {
  return screen.getByText('Simulated live P&L').parentElement as HTMLElement;
}

// PURPOSE: Validate ATM selection, reset behavior, and live branch handling in the short-straddle simulator.
describe('components/StraddleTracker', () => {
  // PURPOSE: With no ATM candidate, the simulator should stay idle and prevent tracking.
  it('disables tracking when there is no valid option data', () => {
    // Rendering with no data reproduces the dashboard state before option-chain loading.
    render(<StraddleTracker data={[]} />);

    // The simulator should explain that it is waiting for a valid ATM strike.
    expect(screen.getByText(/ATM strike \(\.\.\.\)/)).toBeInTheDocument();
    // The start button should stay disabled because there is no trackable contract.
    expect(screen.getByRole('button', { name: /start/i })).toBeDisabled();
  });

  // PURPOSE: This integration test protects the live P&L calculation from regressions.
  it('starts at the ATM strike and updates simulated P&L as prices move', async () => {
    // The user-event helper lets the test interact with the real button behavior.
    const user = userEvent.setup();
    // Rendering with a symmetric chain ensures the ATM strike resolves to 100.
    const { rerender } = render(<StraddleTracker data={initialData} />);

    // Starting the tracker captures the current ATM CE and PE prices as the entry premium.
    await user.click(screen.getByRole('button', { name: /start/i }));

    // The tracked strike should be surfaced in the live status panel.
    expect(await screen.findByText('LIVE TRACKING')).toBeInTheDocument();
    // The status panel should show the selected ATM strike.
    expect(expectStrikeLabel(100)).toBeInTheDocument();

    // This rerender simulates both option legs decaying after the short straddle is entered.
    rerender(
      <StraddleTracker
        data={[
          initialData[0],
          {
            strikePrice: 100,
            CE: { openInterest: 100, changeinOpenInterest: 0, totalTradedVolume: 10, lastPrice: 90 },
            PE: { openInterest: 100, changeinOpenInterest: 0, totalTradedVolume: 10, lastPrice: 80 },
          },
          initialData[2],
        ]}
      />
    );

    // The P&L should update after the rerender-driven effect processes the new prices.
    await waitFor(() => {
      expect(screen.getByText('+₹1500.00')).toBeInTheDocument();
    });
    // The points gain should match the premium drop from 200 to 170.
    expect(screen.getByText('+30.00 pts')).toBeInTheDocument();
  });

  // PURPOSE: Rising option prices should produce losses and hit the leg-wise stop-loss branch when severe enough.
  it('shows negative P&L when option prices rise after entry', async () => {
    // The user-event helper lets the test interact with the real button behavior.
    const user = userEvent.setup();
    // Rendering with a symmetric chain ensures the ATM strike resolves to 100.
    const { rerender } = render(<StraddleTracker data={initialData} />);

    // Starting the tracker captures the ATM premiums as the short entry.
    await user.click(screen.getByRole('button', { name: /start/i }));

    // This rerender simulates both legs rising far enough to breach the 25% leg-wise stop loss.
    rerender(
      <StraddleTracker
        data={[
          initialData[0],
          {
            strikePrice: 100,
            CE: { openInterest: 100, changeinOpenInterest: 0, totalTradedVolume: 10, lastPrice: 130 },
            PE: { openInterest: 100, changeinOpenInterest: 0, totalTradedVolume: 10, lastPrice: 130 },
          },
          initialData[2],
        ]}
      />
    );

    // The simulator should report that the stop loss was hit once both legs breach their thresholds.
    expect(await screen.findByText('STOP LOSS HIT')).toBeInTheDocument();
    // The MTM should go negative because the short premium expanded after entry.
    expect(getPnlPanel()).toHaveTextContent('₹-3000.00');
    // The points should also show the premium loss for the short position.
    expect(getPnlPanel()).toHaveTextContent('-60.00 pts');
  });

  // PURPOSE: Stopping an active tracker should clear trade state so a fresh start begins from zero P&L.
  it('resets P&L to zero when tracking is stopped and restarted', async () => {
    // The user-event helper lets the test interact with the real button behavior.
    const user = userEvent.setup();
    // Rendering with a symmetric chain ensures the ATM strike resolves to 100.
    const { rerender } = render(<StraddleTracker data={initialData} />);

    // Starting the tracker captures the ATM premiums as the short entry.
    await user.click(screen.getByRole('button', { name: /start/i }));

    // This rerender simulates a profitable move so the reset has non-zero state to clear.
    rerender(
      <StraddleTracker
        data={[
          initialData[0],
          {
            strikePrice: 100,
            CE: { openInterest: 100, changeinOpenInterest: 0, totalTradedVolume: 10, lastPrice: 90 },
            PE: { openInterest: 100, changeinOpenInterest: 0, totalTradedVolume: 10, lastPrice: 80 },
          },
          initialData[2],
        ]}
      />
    );

    // Waiting for the positive MTM confirms the tracker accumulated non-zero state first.
    expect(await screen.findByText('+₹1500.00')).toBeInTheDocument();

    // Stopping should take the component back to its idle explanation state.
    await user.click(screen.getByRole('button', { name: /stop/i }));
    expect(await screen.findByText(/click "Start" to simulate a Short Straddle/)).toBeInTheDocument();

    // Returning to the original prices ensures the fresh restart begins from the original ATM snapshot.
    rerender(<StraddleTracker data={initialData} />);

    // Starting again should recreate a new trade from a clean zero-P&L baseline.
    await user.click(screen.getByRole('button', { name: /start/i }));
    await waitFor(() => {
      expect(getPnlPanel()).toHaveTextContent('+₹0.00');
    });
    // The reset should also clear any prior point gain or loss.
    expect(getPnlPanel()).toHaveTextContent('+0.00 pts');
  });

  // PURPOSE: Even if the live ATM changes, the active trade should keep tracking the originally entered strike.
  it('keeps the original strike when ATM changes while tracking is live', async () => {
    // The user-event helper lets the test interact with the real select and start button.
    const user = userEvent.setup();
    // Rendering with a symmetric chain ensures the initial ATM strike resolves to 100.
    const { rerender } = render(<StraddleTracker data={initialData} />);

    // Switching to combined trailing covers the alternative strategy branch and its default stop-loss reset.
    await user.selectOptions(screen.getByRole('combobox'), 'COMBINED_TRAILING');
    // The stop-loss control should switch to the combined-trailing default of 5 points.
    expect(screen.getByDisplayValue('5')).toBeInTheDocument();

    // Starting the tracker locks in strike 100 as the trade being tracked.
    await user.click(screen.getByRole('button', { name: /start/i }));
    expect(await screen.findByText('LIVE TRACKING')).toBeInTheDocument();

    // This rerender makes 110 the new ATM while the original 100 strike continues to move.
    rerender(
      <StraddleTracker
        data={[
          {
            strikePrice: 90,
            CE: { openInterest: 100, changeinOpenInterest: 0, totalTradedVolume: 10, lastPrice: 150 },
            PE: { openInterest: 100, changeinOpenInterest: 0, totalTradedVolume: 10, lastPrice: 60 },
          },
          {
            strikePrice: 100,
            CE: { openInterest: 100, changeinOpenInterest: 0, totalTradedVolume: 10, lastPrice: 95 },
            PE: { openInterest: 100, changeinOpenInterest: 0, totalTradedVolume: 10, lastPrice: 95 },
          },
          {
            strikePrice: 110,
            CE: { openInterest: 100, changeinOpenInterest: 0, totalTradedVolume: 10, lastPrice: 100 },
            PE: { openInterest: 100, changeinOpenInterest: 0, totalTradedVolume: 10, lastPrice: 100 },
          },
        ]}
      />
    );

    // The tracked strike label should remain on the original entry strike rather than the new ATM.
    expect(await screen.findByText((_, node) => node?.textContent === 'Strike: 100')).toBeInTheDocument();
    // The combined trailing branch should trail the stop to the new lower premium.
    expect(screen.getByText('195.00')).toBeInTheDocument();
    // The base premium should also move down to the new combined premium.
    expect(screen.getByText('Base: 190.00')).toBeInTheDocument();
  });

  // PURPOSE: A low monetary target should terminate tracking through the target-profit branch.
  it('marks the trade as target achieved when the MTM reaches the configured profit target', async () => {
    // The user-event helper lets the test edit controls before starting the trade.
    const user = userEvent.setup();
    // Rendering with a symmetric chain ensures the ATM strike resolves to 100.
    const { rerender } = render(<StraddleTracker data={initialData} />);

    // Lowering the monetary target makes the target branch reachable in a compact test fixture.
    const targetInput = screen.getByDisplayValue('5000');
    await user.clear(targetInput);
    await user.type(targetInput, '1000');
    // The updated value confirms the test changed the target rather than another numeric control.
    const updatedTargetInput = screen.getByDisplayValue('1000');
    expect(updatedTargetInput).toBeInTheDocument();

    // Starting the tracker locks in the ATM premiums as the short entry.
    await user.click(screen.getByRole('button', { name: /start/i }));

    // This rerender reduces combined premium enough to exceed the lowered profit target.
    rerender(
      <StraddleTracker
        data={[
          initialData[0],
          {
            strikePrice: 100,
            CE: { openInterest: 100, changeinOpenInterest: 0, totalTradedVolume: 10, lastPrice: 90 },
            PE: { openInterest: 100, changeinOpenInterest: 0, totalTradedVolume: 10, lastPrice: 80 },
          },
          initialData[2],
        ]}
      />
    );

    // The target branch should terminate the trade with the achievement status.
    expect(await screen.findByText('TARGET ACHIEVED')).toBeInTheDocument();
    // The MTM should reflect the profitable move that hit the target.
    expect(getPnlPanel()).toHaveTextContent('+₹1500.00');
  });
});
