import { linearGradient } from "@jasy/pdf";
import {
  Box,
  Column,
  Document,
  Expanded,
  Page,
  Positioned,
  Rotated,
  RotatedBox,
  Row,
  Text,
  type BoxProps,
} from "@jasy/react";
import type { ReactNode } from "react";

const BLUE = "#1450aa";
const COLORS = ["#0a2348", "#1450aa", "#3b82f6"];

// Plain React composition: a titled section is just a component.
function Demo({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <Column gap={6} keepTogether>
      <Text size={12} bold color="#0a2348">
        {title}
      </Text>
      <Text size={9} color="#64748b">
        {note}
      </Text>
      {children}
    </Column>
  );
}

const Tile = ({ children, ...box }: BoxProps & { children: string }) => (
  <Box bg="#e0e9f8" padding={8} radius={4} {...box}>
    <Text size={10} color={BLUE} align="center">
      {children}
    </Text>
  </Box>
);

export default function Layout() {
  return (
    <Document size={11} color="#1f2937">
      <Page size="A4" gap={18}>
        <Text size={24} bold color="#0a2348">
          Layout, the way you know it
        </Text>

        <Demo title="Flex" note="Expanded shares the leftover space by its flex: 1 · 2 · 1.">
          <Row gap={8}>
            <Expanded flex={1}>
              <Tile>flex 1</Tile>
            </Expanded>
            <Expanded flex={2}>
              <Tile bg="#c7d7f3">flex 2</Tile>
            </Expanded>
            <Expanded flex={1}>
              <Tile>flex 1</Tile>
            </Expanded>
          </Row>
        </Demo>

        <Demo
          title="Wrap"
          note={'wrap breaks the Row into lines; width="31%" is a share of the line.'}
        >
          <Row wrap gap={8}>
            {["Invoices", "Reports", "Forms", "Tickets", "Labels", "Letters", "Certificates"].map(
              (label) => (
                <Tile key={label} width="31%">
                  {label}
                </Tile>
              ),
            )}
          </Row>
        </Demo>

        <Demo
          title="Align"
          note="A child with its own height leaves the Row's alignment with alignSelf."
        >
          <Row gap={8} height={70} align="start">
            <Tile height={28}>start</Tile>
            <Tile height={28} alignSelf="center">
              center
            </Tile>
            <Tile height={28} alignSelf="end">
              end
            </Tile>
            <Expanded>
              <Tile>no height: it fills the Row</Tile>
            </Expanded>
          </Row>
        </Demo>

        <Row gap={18}>
          <Expanded>
            <Demo
              title="Overlap with zIndex"
              note="The first card in the tree paints on top: zIndex orders."
            >
              <Box relative height={92}>
                {[0, 1, 2].map((i) => (
                  <Positioned key={i} left={i * 34} top={i * 14} zIndex={3 - i}>
                    <Box width={110} height={56} radius={6} padding={6} bg={COLORS[i]}>
                      <Column height={44} justify="end">
                        <Text size={9} bold color="#ffffff" align="right">
                          {`zIndex ${3 - i}`}
                        </Text>
                      </Column>
                    </Box>
                  </Positioned>
                ))}
              </Box>
            </Demo>
          </Expanded>
          <Expanded>
            <Demo title="Stamp" note="Rotated spins at paint time; nothing reflows.">
              <Box relative height={92} border="#cbd5e1" radius={6} padding={10}>
                <Text size={10}>Invoice 2026-0042</Text>
                <Text size={10} color="#64748b">
                  5,400.00 EUR
                </Text>
                <Positioned h="center" v="center">
                  <Rotated angle={-14}>
                    <Box border="#dc2626" borderWidth={2} radius={4} padding={{ x: 12, y: 4 }}>
                      <Text size={20} bold color="#dc2626" letterSpacing={2}>
                        PAID
                      </Text>
                    </Box>
                  </Rotated>
                </Positioned>
              </Box>
            </Demo>
          </Expanded>
        </Row>

        <Row gap={18}>
          <Expanded>
            <Demo title="Gradient and corners" note="A gradient fill, each corner its own radius.">
              <Box
                height={70}
                padding={14}
                radius={{ topLeft: 22, bottomRight: 22 }}
                bg={linearGradient({ angle: 90, stops: ["#0a2348", "#1450aa", "#3b82f6"] })}
              >
                <Text size={14} bold color="#ffffff">
                  Gradient
                </Text>
              </Box>
            </Demo>
          </Expanded>
          <Expanded>
            <Demo
              title="Vertical label"
              note="RotatedBox turns a quarter and swaps width and height."
            >
              <Row gap={10} height={70}>
                <Box bg="#f3dc29" padding={{ x: 6, y: 4 }}>
                  <RotatedBox turns={3}>
                    <Text size={9} bold color="#0a2348">
                      NEW
                    </Text>
                  </RotatedBox>
                </Box>
                <Expanded>
                  <Text size={10}>
                    The label stands upright, and the text beside it makes room.
                  </Text>
                </Expanded>
              </Row>
            </Demo>
          </Expanded>
        </Row>
      </Page>
    </Document>
  );
}
