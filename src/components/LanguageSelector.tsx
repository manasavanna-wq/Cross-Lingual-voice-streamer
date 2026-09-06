import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowRight } from "lucide-react";

interface LanguageSelectorProps {
  sourceLang: string;
  targetLang: string;
  onSourceChange: (lang: string) => void;
  onTargetChange: (lang: string) => void;
  disabled?: boolean;
}

const allLanguages = [
  "English",
  "Tamil",
  "Hindi",
  "Telugu",
  "Bengali",
  "Marathi",
  "Kannada",
  "Malayalam",
  "Gujarati",
  "Punjabi",
];

const sourceLanguages = allLanguages;

const targetLanguages = allLanguages;


export function LanguageSelector({
  sourceLang,
  targetLang,
  onSourceChange,
  onTargetChange,
  disabled,
}: LanguageSelectorProps) {
  return (
    <div className="flex items-center gap-4">
      <div className="flex-1">
        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
          Hearer speaks
        </label>
        <Select value={sourceLang} onValueChange={onSourceChange} disabled={disabled}>
          <SelectTrigger className="w-full bg-secondary/50 border-0 h-11">
            <SelectValue placeholder="Select language" />
          </SelectTrigger>
          <SelectContent>
            {sourceLanguages.map((lang) => (
              <SelectItem key={lang} value={lang}>
                {lang}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-center pt-5">
        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
          <ArrowRight className="w-5 h-5 text-primary" />
        </div>
      </div>

      <div className="flex-1">
        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
          Listener hears
        </label>
        <Select value={targetLang} onValueChange={onTargetChange} disabled={disabled}>
          <SelectTrigger className="w-full bg-secondary/50 border-0 h-11">
            <SelectValue placeholder="Select language" />
          </SelectTrigger>
          <SelectContent>
            {targetLanguages.map((lang) => (
              <SelectItem key={lang} value={lang}>
                {lang}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
