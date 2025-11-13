export type ListDTOParams<T> = {
  items: T[];
  total: number;
  page: number;
  limit: number;
};
