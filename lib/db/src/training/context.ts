import { AsyncLocalStorage } from "node:async_hooks";

type TrainingContext = { database: object; generation: string };
const context = new AsyncLocalStorage<TrainingContext>();

export const isTraining = () => context.getStore() !== undefined;
export const trainingGeneration = () => context.getStore()?.generation;
export const trainingDatabase = () => context.getStore()?.database;
export function inTrainingContext<T>(database: object, generation: string, action: () => T): T {
  return context.run({ database, generation }, action);
}
