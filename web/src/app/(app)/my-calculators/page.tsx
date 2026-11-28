"use client";

import { useCallback } from "react";
import { INSIGHT_TABS, SubTabs } from "@/components/app-ui";
import { Calculators } from "@/components/calculators";
import { PageHeader, Skeleton } from "@/components/common";
import { deleteScenario, errorMessage, getCalculatorPrefill, listScenarios, saveScenario } from "@/lib/api";
import { useAsync } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import type { CalculatorKey, ScenarioInputs } from "@/lib/types";

export default function MyCalculatorsPage() {
  const { me } = useSession();
  const prefill = useAsync(getCalculatorPrefill, "calc-prefill");
  const scenarios = useAsync(listScenarios, "calc-scenarios");
  const saved = Object.fromEntries((scenarios.data?.items ?? []).map((s) => [s.calculator, s.inputs])) as Partial<Record<CalculatorKey, ScenarioInputs>>;
  const reload = scenarios.reload;
  const onSave = useCallback(
    async (k: CalculatorKey, inputs: ScenarioInputs) => {
      try {
        await saveScenario(k, inputs);
      } catch (e) {
        throw new Error(errorMessage(e));
      }
    },
    [],
  );
  const onDelete = useCallback(
    async (k: CalculatorKey) => {
      await deleteScenario(k);
      reload();
    },
    [reload],
  );
  const ready = (prefill.data || prefill.error) && (scenarios.data || scenarios.error);
  return (
    <>
      <PageHeader eyebrow="Insights" title="Calculators" subtitle="FIRE, investing, loans and card payoff, filled in from your own spending, net worth and card statements." />
      <SubTabs label="Insights" items={INSIGHT_TABS} />
      {!ready ? (
        <Skeleton className="h-96 rounded-2xl" />
      ) : (
        <Calculators currency={prefill.data?.currency ?? me.baseCurrency} prefill={prefill.data ?? null} saved={saved} onSave={onSave} onDelete={onDelete} />
      )}
    </>
  );
}
