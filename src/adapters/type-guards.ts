export function isAsyncIterable(
  value: unknown,
): value is AsyncIterable<unknown> {
  if (value === null || typeof value !== "object") {
    return false;
  }

  return (
    typeof (value as Record<PropertyKey, unknown>)[Symbol.asyncIterator] ===
    "function"
  );
}

export function hasMethod(value: unknown, method: string): boolean {
  if (value === null || typeof value !== "object") {
    return false;
  }

  return typeof (value as Record<string, unknown>)[method] === "function";
}

export function hasProperty(value: unknown, property: string): boolean {
  if (value === null || typeof value !== "object") {
    return false;
  }

  return property in (value as Record<string, unknown>);
}

export function assertAsyncIterable(
  value: unknown,
  adapterName: string,
): asserts value is AsyncIterable<unknown> {
  if (!isAsyncIterable(value)) {
    throw new TypeError(
      `${adapterName} expected an AsyncIterable-compatible stream surface.`,
    );
  }
}

export function makeIteratorProxy<T extends object>(
  source: T,
  iteratorFactory: () => AsyncIterable<unknown>,
): T {
  return new Proxy(source, {
    get(target, prop, receiver) {
      if (prop === Symbol.asyncIterator) {
        const iterable = iteratorFactory();
        return iterable[Symbol.asyncIterator].bind(iterable);
      }

      const value = Reflect.get(target, prop, receiver);
      if (typeof value === "function") {
        return value.bind(target);
      }

      return value;
    },
  });
}
