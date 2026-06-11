import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL  = "https://gvcubfqflxmfuikoqhdl.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd2Y3ViZnFmbHhtZnVpa29xaGRsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3NTI4ODgsImV4cCI6MjA5NjMyODg4OH0.xHSnCdIRp311QnbHeyyxKSwm8t25dF2OjeLyEB-hE3Q";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);
