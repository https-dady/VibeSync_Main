'use strict';

function pagination(query, { defaultLimit = 30, maxLimit = 100 } = {}) {
  const limit = Math.min(Math.max(Number(query.limit) || defaultLimit, 1), maxLimit);
  const cursor = query.cursor || null;
  return { limit, cursor };
}

function pageResult(items, limit) {
  const hasMore = items.length > limit;
  const data = hasMore ? items.slice(0, limit) : items;
  return {
    data,
    nextCursor: hasMore ? data[data.length - 1]?.id || null : null,
    hasMore,
  };
}

module.exports = { pagination, pageResult };
