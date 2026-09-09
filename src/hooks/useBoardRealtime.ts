import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export function useBoardRealtime() {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel("board")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "order_tasks" },
        () => {
          qc.invalidateQueries({ queryKey: ["board_tasks"] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);
}
