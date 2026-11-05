<script setup lang="ts">
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
} from "@jasy/vue";

const CARDS = ["#0a2348", "#1450aa", "#3b82f6"];
const CHIPS = ["Invoices", "Reports", "Forms", "Tickets", "Labels", "Letters", "Certificates"];
const gradient = linearGradient({ angle: 90, stops: ["#0a2348", "#1450aa", "#3b82f6"] });
</script>

<template>
  <Document :size="11" color="#1f2937">
    <Page size="A4" :gap="18">
      <Text :size="24" bold color="#0a2348">Layout, the way you know it</Text>

      <Column :gap="6" keep-together>
        <Text :size="12" bold color="#0a2348">Flex</Text>
        <Text :size="9" color="#64748b"
          >Expanded shares the leftover space by its flex: 1 · 2 · 1.</Text
        >
        <Row :gap="8">
          <Expanded :flex="1"
            ><Box bg="#e0e9f8" :padding="8" :radius="4"
              ><Text :size="10" color="#1450aa" align="center">flex 1</Text></Box
            ></Expanded
          >
          <Expanded :flex="2"
            ><Box bg="#c7d7f3" :padding="8" :radius="4"
              ><Text :size="10" color="#1450aa" align="center">flex 2</Text></Box
            ></Expanded
          >
          <Expanded :flex="1"
            ><Box bg="#e0e9f8" :padding="8" :radius="4"
              ><Text :size="10" color="#1450aa" align="center">flex 1</Text></Box
            ></Expanded
          >
        </Row>
      </Column>

      <Column :gap="6" keep-together>
        <Text :size="12" bold color="#0a2348">Wrap</Text>
        <Text :size="9" color="#64748b"
          >wrap breaks the Row into lines; width="31%" is a share of the line.</Text
        >
        <Row wrap :gap="8">
          <Box v-for="chip in CHIPS" :key="chip" width="31%" bg="#e0e9f8" :padding="8" :radius="4">
            <Text :size="10" color="#1450aa" align="center">{{ chip }}</Text>
          </Box>
        </Row>
      </Column>

      <Column :gap="6" keep-together>
        <Text :size="12" bold color="#0a2348">Align</Text>
        <Text :size="9" color="#64748b"
          >A child with its own height leaves the Row's alignment with align-self.</Text
        >
        <Row :gap="8" :height="70" align="start">
          <Box :height="28" bg="#e0e9f8" :padding="8" :radius="4"
            ><Text :size="10" color="#1450aa">start</Text></Box
          >
          <Box :height="28" align-self="center" bg="#e0e9f8" :padding="8" :radius="4"
            ><Text :size="10" color="#1450aa">center</Text></Box
          >
          <Box :height="28" align-self="end" bg="#e0e9f8" :padding="8" :radius="4"
            ><Text :size="10" color="#1450aa">end</Text></Box
          >
          <Expanded
            ><Box bg="#e0e9f8" :padding="8" :radius="4"
              ><Text :size="10" color="#1450aa" align="center"
                >no height: it fills the Row</Text
              ></Box
            ></Expanded
          >
        </Row>
      </Column>

      <Row :gap="18">
        <Expanded>
          <Column :gap="6" keep-together>
            <Text :size="12" bold color="#0a2348">Overlap with z-index</Text>
            <Text :size="9" color="#64748b"
              >The first card in the tree paints on top: z-index orders.</Text
            >
            <Box relative :height="92">
              <Positioned
                v-for="(color, i) in CARDS"
                :key="color"
                :left="i * 34"
                :top="i * 14"
                :z-index="3 - i"
              >
                <Box :width="110" :height="56" :radius="6" :padding="6" :bg="color">
                  <Column :height="44" justify="end">
                    <Text :size="9" bold color="#ffffff" align="right">z-index {{ 3 - i }}</Text>
                  </Column>
                </Box>
              </Positioned>
            </Box>
          </Column>
        </Expanded>
        <Expanded>
          <Column :gap="6" keep-together>
            <Text :size="12" bold color="#0a2348">Stamp</Text>
            <Text :size="9" color="#64748b">Rotated spins at paint time; nothing reflows.</Text>
            <Box relative :height="92" border="#cbd5e1" :radius="6" :padding="10">
              <Text :size="10">Invoice 2026-0042</Text>
              <Text :size="10" color="#64748b">5,400.00 EUR</Text>
              <Positioned h="center" v="center">
                <Rotated :angle="-14">
                  <Box border="#dc2626" :border-width="2" :radius="4" :padding="{ x: 12, y: 4 }">
                    <Text :size="20" bold color="#dc2626" :letter-spacing="2">PAID</Text>
                  </Box>
                </Rotated>
              </Positioned>
            </Box>
          </Column>
        </Expanded>
      </Row>

      <Row :gap="18">
        <Expanded>
          <Column :gap="6" keep-together>
            <Text :size="12" bold color="#0a2348">Gradient and corners</Text>
            <Text :size="9" color="#64748b">A gradient fill, each corner its own radius.</Text>
            <Box
              :height="70"
              :padding="14"
              :radius="{ topLeft: 22, bottomRight: 22 }"
              :bg="gradient"
            >
              <Text :size="14" bold color="#ffffff">Gradient</Text>
            </Box>
          </Column>
        </Expanded>
        <Expanded>
          <Column :gap="6" keep-together>
            <Text :size="12" bold color="#0a2348">Vertical label</Text>
            <Text :size="9" color="#64748b"
              >RotatedBox turns a quarter and swaps width and height.</Text
            >
            <Row :gap="10" :height="70">
              <Box bg="#f3dc29" :padding="{ x: 6, y: 4 }">
                <RotatedBox :turns="3"><Text :size="9" bold color="#0a2348">NEW</Text></RotatedBox>
              </Box>
              <Expanded
                ><Text :size="10"
                  >The label stands upright, and the text beside it makes room.</Text
                ></Expanded
              >
            </Row>
          </Column>
        </Expanded>
      </Row>
    </Page>
  </Document>
</template>
