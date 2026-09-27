# Agent Note: Manual API-key setup

Status: implemented

English | [中文](2026-09-15-optional-api-key-onboarding.zh.md)

## Problem

Users can manage projects before configuring a model. An automatic DeepSeek credential dialog interrupts that workflow and assumes the user's provider choice.

## Decision

The [Models plugin](../../../../packages/client/ui-settings-models/README.md) registers only the welcome notice during onboarding. API-key configuration lives in the manually opened Models page. The welcome notice and manual Models settings remain available; no stored credential or acknowledgement is fabricated.

## Alternatives considered

Writing a completed-onboarding flag from a launcher would depend on the selected data directory and misrepresent user actions. Removing the Models credential editor would prevent manual configuration.

## Consequences

New installations enter the application without a credential prompt. Users must open Models settings before using a provider that needs a key. Registration tests cover the welcome-only onboarding list; browser expectations cover fresh startup, reload, and manual credential configuration.
