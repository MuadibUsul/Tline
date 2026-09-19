export type ChoiceQuestion = {
  type: "choice";
  instructions: string;
  criteria: Record<string, string | null>;
};

export type ScoreQuestion = {
  type: "score";
  instructions: string;
  criteria: string[];
};

export type NoulQuestion = {
  type: "noul";
  instructions: string;
  criteria?: { true: string; false: string };
};

export type DecisionQuestion = ChoiceQuestion | ScoreQuestion | NoulQuestion;

export type ChoiceAnswer = {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
};

export type ScoreAnswer = {
  type: "score";
  score: number;
  legend: Record<string, string>;
  probabilities: Record<string, number>;
  confidence: number;
};

export type NoulAnswer = { type: "noul"; noul: number };
export type DecisionAnswer = ChoiceAnswer | ScoreAnswer | NoulAnswer;

export interface DecisionRequest {
  decisionType: string;
  state: unknown;
  questions: Record<string, DecisionQuestion>;
  audit?: {
    contentId?: string;
    classificationId?: string;
    requestFingerprint?: string;
    baselineValue?: string;
    shadowMode?: boolean;
  };
}

export interface DecisionResponse {
  provider: string;
  model: string;
  answers: Record<string, DecisionAnswer>;
  usage: { inputTokens: number; outputTokens: number };
}

export interface DecisionProvider {
  readonly name: string;
  readonly model: string;
  evaluate(request: DecisionRequest): Promise<DecisionResponse>;
}
