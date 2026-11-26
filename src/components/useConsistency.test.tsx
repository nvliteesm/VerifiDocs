// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Api } from "@/lib/client/api";
import { useConsistency } from "./useConsistency";

afterEach(cleanup);

const reply = (unit: number, figures: { label: string; value: string; unit: string | null; sentence: string; section: string | null }[]) => ({ unit, unitCount: 3, figures, dropped: 0 });

describe("useConsistency", () => {
  it("reads every part, compares across parts, and reports the figure that disagrees", async () => {
    const readFigures = vi.fn(async (_run: string, unit: number) =>
      unit === 0
        ? reply(0, [{ label: "Daya serap air batako daun ketapang kering", value: "1,893", unit: "%", sentence: "Berdasarkan tabel 4.5 daya serap air batako daun ketapang kering sebesar 1,893%.", section: "Hasil" }])
        : unit === 2
          ? reply(2, [{ label: "Daya serap air batako daun ketapang kering", value: "1,839", unit: "%", sentence: "Pengujian daya serap air batako daun ketapang kering menghasilkan nilai 1,839%.", section: "Kesimpulan" }])
          : reply(1, []),
    );
    const { result } = renderHook(() => useConsistency({ readFigures } as unknown as Api, "run-1", 3));
    await act(async () => {
      await result.current.run();
    });
    expect(readFigures).toHaveBeenCalledTimes(3);
    expect(result.current.phase).toBe("done");
    expect(result.current.figureCount).toBe(2);
    expect(result.current.found).toHaveLength(1);
    expect(result.current.found[0]!.places.map((p) => p.value)).toEqual(["1,893", "1,839"]);
  });

  it("works two parts at a time", async () => {
    let active = 0;
    let peak = 0;
    const readFigures = vi.fn(async (_r: string, unit: number) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return reply(unit, []);
    });
    const { result } = renderHook(() => useConsistency({ readFigures } as unknown as Api, "run-1", 5));
    await act(async () => {
      await result.current.run();
    });
    expect(peak).toBe(2);
  });

  it("still shows what it could read when one part fails, and fails only when every part does", async () => {
    const partial = vi.fn(async (_r: string, unit: number) => {
      if (unit === 1) throw new Error("later");
      return reply(unit, []);
    });
    const one = renderHook(() => useConsistency({ readFigures: partial } as unknown as Api, "run-1", 3));
    await act(async () => {
      await one.result.current.run();
    });
    expect(one.result.current.phase).toBe("done");

    const none = renderHook(() => useConsistency({ readFigures: async () => { throw new Error("down"); } } as unknown as Api, "run-2", 2));
    await act(async () => {
      await none.result.current.run();
    });
    expect(none.result.current.phase).toBe("failed");
  });

  it("starts fresh when the run changes", async () => {
    const readFigures = vi.fn(async (_r: string, unit: number) => reply(unit, []));
    const { result, rerender } = renderHook(({ id }) => useConsistency({ readFigures } as unknown as Api, id, 1), { initialProps: { id: "a" as string | null } });
    await act(async () => {
      await result.current.run();
    });
    expect(result.current.phase).toBe("done");
    rerender({ id: "b" });
    expect(result.current.phase).toBe("idle");
  });

  it("asks for the findings that may contradict once every part is read, and shows them", async () => {
    const pair = { a: { sentence: "Daun kering menyerap paling sedikit.", section: "Hasil", part: 0 }, b: { sentence: "Daun kering menyerap paling banyak.", section: "Kesimpulan", part: 1 }, note: "paling sedikit / paling banyak" };
    const findContradictions = vi.fn(async () => [pair]);
    const readFigures = vi.fn(async (_r: string, unit: number) => reply(unit, []));
    const { result } = renderHook(() => useConsistency({ readFigures, findContradictions } as unknown as Api, "run-1", 2));
    await act(async () => {
      await result.current.run();
    });
    expect(findContradictions).toHaveBeenCalledWith("run-1", false);
    expect(result.current.contradictions).toEqual([pair]);
  });

  it("does not ask for contradictions when a part could not be read, and the numbers still show", async () => {
    const findContradictions = vi.fn(async () => []);
    const readFigures = vi.fn(async (_r: string, unit: number) => {
      if (unit === 1) throw new Error("later");
      return reply(unit, []);
    });
    const { result } = renderHook(() => useConsistency({ readFigures, findContradictions } as unknown as Api, "run-1", 2));
    await act(async () => {
      await result.current.run();
    });
    expect(findContradictions).not.toHaveBeenCalled();
    expect(result.current.phase).toBe("done");
  });

  it("shows the saved answer after a reload, with no model request", async () => {
    const figure = (value: string, section: string, sentence: string) => ({ label: "Daya serap air batako daun ketapang kering", value, unit: "%", sentence, section });
    const savedFigures = vi.fn(async () => ({
      unitCount: 2,
      units: [
        { unit: 0, partial: false, figures: [figure("1,893", "Hasil", "Berdasarkan tabel 4.5 daya serap air batako daun ketapang kering sebesar 1,893%.")] },
        { unit: 1, partial: false, figures: [figure("1,839", "Kesimpulan", "Pengujian daya serap air batako daun ketapang kering menghasilkan nilai 1,839%.")] },
      ],
      contradictions: [],
    }));
    const readFigures = vi.fn();
    const { result } = renderHook(() => useConsistency({ readFigures, savedFigures } as unknown as Api, "run-1", 2));
    await vi.waitFor(() => expect(result.current.phase).toBe("done"));
    expect(result.current.found).toHaveLength(1);
    expect(readFigures).not.toHaveBeenCalled();
  });

  it("shows nothing from a save that is missing a part, and 'Check again' reads everything fresh", async () => {
    const savedFigures = vi.fn(async () => ({ unitCount: 2, units: [{ unit: 0, partial: false, figures: [] }], contradictions: null }));
    const readFigures = vi.fn(async (_r: string, unit: number) => reply(unit, []));
    const { result } = renderHook(() => useConsistency({ readFigures, savedFigures } as unknown as Api, "run-1", 2));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.phase).toBe("idle");
    await act(async () => {
      await result.current.run();
    });
    expect(readFigures).toHaveBeenLastCalledWith("run-1", expect.any(Number), false);
    await act(async () => {
      await result.current.run();
    });
    expect(readFigures).toHaveBeenLastCalledWith("run-1", expect.any(Number), true);
  });
});
