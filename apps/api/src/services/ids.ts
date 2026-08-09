import { randomUUID } from "node:crypto";

export interface IdFactory {
  create(prefix: string): string;
}

export const defaultIdFactory: IdFactory = {
  create(prefix) {
    return `${prefix}_${randomUUID()}`;
  },
};
