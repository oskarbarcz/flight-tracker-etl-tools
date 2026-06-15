import { createClient } from './client.ts';
import type { CreateOperatorRequest, Operator } from '../operator/operator.types.ts';

const BASE = '/api/v1/operator';

export function operatorsApi(token: string) {
  const { request } = createClient(token);
  return {
    list: () => request<Operator[]>('GET', BASE),
    create: (body: CreateOperatorRequest) => request<Operator>('POST', BASE, body),
    update: (id: string, body: Partial<CreateOperatorRequest>) =>
      request<Operator>('PATCH', `${BASE}/${id}`, body),
  };
}
