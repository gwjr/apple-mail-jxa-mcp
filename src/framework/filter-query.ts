// src/framework/filter-query.ts - Query & Filter System
//
// Filtering, sorting, pagination for collections.

// ─────────────────────────────────────────────────────────────────────────────
// Filter Operators
// ─────────────────────────────────────────────────────────────────────────────

const equalsOp: FilterOperator<any> = {
  name: 'equals',
  parseUri: (s) => s,
  toJxa: (v) => v,
  test: (a, b) => a === b,
  toUri: (v) => encodeURIComponent(String(v)),
};

const containsOp: FilterOperator<string> = {
  name: 'contains',
  parseUri: (s) => s,
  toJxa: (v) => ({ _contains: v }),
  test: (a, b) => typeof a === 'string' && a.includes(b),
  toUri: (v) => encodeURIComponent(v),
};

const startsWithOp: FilterOperator<string> = {
  name: 'startsWith',
  parseUri: (s) => s,
  toJxa: (v) => ({ _beginsWith: v }),
  test: (a, b) => typeof a === 'string' && a.startsWith(b),
  toUri: (v) => encodeURIComponent(v),
};

const gtOp: FilterOperator<number> = {
  name: 'gt',
  parseUri: parseFloat,
  toJxa: (v) => ({ _greaterThan: v }),
  test: (a, b) => a > b,
  toUri: (v) => String(v),
};

const ltOp: FilterOperator<number> = {
  name: 'lt',
  parseUri: parseFloat,
  toJxa: (v) => ({ _lessThan: v }),
  test: (a, b) => a < b,
  toUri: (v) => String(v),
};

const filterOperators = [equalsOp, containsOp, startsWithOp, gtOp, ltOp] as const;

function getOperatorByName(name: string): FilterOperator<any> | undefined {
  return filterOperators.find(op => op.name === name);
}

// ─────────────────────────────────────────────────────────────────────────────
// Predicate Factories
// ─────────────────────────────────────────────────────────────────────────────

const equals = (value: any): Predicate => ({ operator: equalsOp, value });
const contains = (value: string): Predicate => ({ operator: containsOp, value });
const startsWith = (value: string): Predicate => ({ operator: startsWithOp, value });
const gt = (value: number): Predicate => ({ operator: gtOp, value });
const lt = (value: number): Predicate => ({ operator: ltOp, value });

// ─────────────────────────────────────────────────────────────────────────────
// Query State Application
// ─────────────────────────────────────────────────────────────────────────────

// Helper to get a property value, handling JXA specifiers (functions)
function getPropValue(item: any, field: string): any {
  if (item && typeof item === 'object' && field in item) {
    const val = item[field];
    return typeof val === 'function' ? val() : val;
  }
  // JXA specifier: property access returns a function to call
  if (typeof item === 'function' && typeof item[field] === 'function') {
    return item[field]();
  }
  return undefined;
}

function applyQueryState<T>(items: T[], query: QueryState): T[] {
  let results = items;

  if (query.filter && Object.keys(query.filter).length > 0) {
    results = results.filter((item: any) => {
      for (const [field, pred] of Object.entries(query.filter!)) {
        const val = getPropValue(item, field);
        if (!pred.operator.test(val, pred.value)) {
          return false;
        }
      }
      return true;
    });
  }

  if (query.sort) {
    const { by, direction = 'asc' } = query.sort;
    results = [...results].sort((a: any, b: any) => {
      const aVal = getPropValue(a, by as string);
      const bVal = getPropValue(b, by as string);
      const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      return direction === 'desc' ? -cmp : cmp;
    });
  }

  if (query.pagination) {
    const { offset = 0, limit } = query.pagination;
    results = limit !== undefined ? results.slice(offset, offset + limit) : results.slice(offset);
  }

  return results;
}
