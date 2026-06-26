import type React from "react";
import { I18nContext, useI18nState } from "./index";

export const LocaleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const state = useI18nState();
  return <I18nContext.Provider value={state}>{children}</I18nContext.Provider>;
};
