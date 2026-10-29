import { z } from "zod";

const str = (max = 800) => z.coerce.string().max(max).catch("");
const strList = (maxItems = 8, maxLen = 400) =>
  z.array(str(maxLen)).max(maxItems).catch([]);

export const planSchema = z.object({
  title: str(160),
  summary: str(1200),
  audience: str(400),
  outcome: str(800),
  assumptions: strList(8, 300),
  openQuestions: strList(8, 300),
  researchQueries: strList(8, 300),
  documents: z
    .array(
      z.object({
        id: str(40),
        title: str(160),
        filename: str(120),
        purpose: str(500),
        chapters: z
          .array(
            z.object({
              id: str(40),
              title: str(160),
              goal: str(400),
              topics: strList(8, 200),
            })
          )
          .max(8)
          .catch([]),
      })
    )
    .max(6)
    .catch([]),
  folderName: str(80),
  needsFolder: z.boolean().catch(false),
});

export const researchSchema = z.object({
  findings: z
    .array(
      z.object({
        query: str(300),
        insight: str(1200),
        useIn: strList(8, 160),
      })
    )
    .max(8)
    .catch([]),
  risks: strList(8, 400),
  recommendedTone: str(120),
  mustInclude: strList(10, 300),
});

export const dispatchSchema = z.object({
  tasks: z
    .array(
      z.object({
        id: str(40),
        fileId: str(40),
        path: str(200),
        title: str(160),
        purpose: str(500),
        leadAgent: str(80),
        subtasks: z
          .array(
            z.object({
              id: str(60),
              chapterId: str(40),
              chapter: str(160),
              heading: str(200),
              topic: str(200),
              agent: str(80),
              brief: str(600),
              minWords: z.coerce.number().int().min(250).max(900).catch(420),
            })
          )
          .max(24)
          .catch([]),
      })
    )
    .max(6)
    .catch([]),
});

export const layoutSchema = z.object({
  mode: z.enum(["single", "folder"]).catch("single"),
  folder: str(80),
  files: z
    .array(
      z.object({
        id: str(40),
        path: str(200),
        title: str(160),
        purpose: str(500),
        outline: z
          .array(
            z.object({
              id: str(40),
              heading: str(200),
              topics: strList(8, 200),
              substeps: strList(10, 300),
            })
          )
          .max(8)
          .catch([]),
      })
    )
    .max(6)
    .catch([]),
});
