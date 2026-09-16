import playbookJson from "../../../../data/macro/analysis-playbooks.json";
import type { Playbook } from "./facts";

/**
 * The desk's playbook per release family: what this print is read for, which comparisons
 * matter, and which questions the read-out has to answer.
 *
 * Kept as data rather than as prose inside a prompt so it can be reviewed and corrected by
 * whoever knows the series — and so a family without an entry still gets a read-out, just a
 * generic one, instead of none.
 */
const playbooks = new Map<string, Playbook>((playbookJson as Playbook[]).map((playbook) => [playbook.family, playbook]));

export function getPlaybook(family: string, title: string): Playbook {
  const known = playbooks.get(family);
  if (known) return known;
  return {
    family,
    topic: title,
    primary: "",
    metrics: [],
    compare: [],
    market: [],
    questions: [
      "公布值相对市场预期与前值的位置，以及本次变化的幅度是否超出常态",
      "这一变化背后的经济含义：对增长、通胀或政策路径意味着什么",
      "市场此前定价了什么，本次数据相对定价的差异在哪里",
      "接下来需要观察什么来确认或推翻这一判断",
    ],
    notes: "",
  };
}

export const playbookFamilies = [...playbooks.keys()];
