import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

/** Plain-language explanation of what intelligence tests measure — and what they do not. */
export function WhatIqMeasures({ defaultOpen = false }: { defaultOpen?: boolean }) {
  return (
    <Accordion type="multiple" defaultValue={defaultOpen ? ["measures", "not"] : []} className="rounded-xl border bg-card px-5">
      <AccordionItem value="measures">
        <AccordionTrigger className="text-base">What IQ tests measure</AccordionTrigger>
        <AccordionContent className="prose-quiet max-w-none text-[0.95rem] text-muted-foreground">
          <p>
            Intelligence tests sample performance on a set of mental tasks — reasoning with novel problems, spatial
            visualisation, working memory, processing speed, and acquired knowledge such as vocabulary. People who do well
            on one kind of task tend to do well on the others. This positive correlation, the general factor <em>g</em>, is
            one of the most replicated findings in psychology, and the Cattell–Horn–Carroll (CHC) model describes how broad
            abilities sit beneath it.
          </p>
          <p>
            An IQ is a <strong>relative</strong> score: it locates a person within a reference group of the same age, on a
            scale where the group&apos;s mean is 100 and its standard deviation is 15. Well-normed IQ scores predict
            educational attainment and some occupational outcomes moderately well at the group level.
          </p>
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="not">
        <AccordionTrigger className="text-base">What they do not measure</AccordionTrigger>
        <AccordionContent className="prose-quiet max-w-none text-[0.95rem] text-muted-foreground">
          <ul>
            <li>
              <strong>Worth, potential or a fixed limit.</strong> Scores describe performance on particular tasks on a
              particular day. They change with education and practice, and differ from one testing to the next.
            </li>
            <li>
              <strong>Creativity, wisdom, social and emotional skills, motivation, or expertise.</strong> These matter a
              great deal for most outcomes and are not what these tasks sample.
            </li>
            <li>
              <strong>Culture-free ability.</strong> Every test reflects the language, schooling and familiarity with tests
              of the people it was built for — vocabulary items most obviously, but abstract puzzles too.
            </li>
            <li>
              <strong>A diagnosis.</strong> Diagnosing intellectual disability, giftedness or learning difficulties requires a
              qualified professional, a validated instrument administered under standard conditions, and information beyond
              any single test score.
            </li>
          </ul>
          <p>
            A single score also hides uncertainty. Even the best clinical instruments report a confidence interval of
            several points around every IQ.
          </p>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
