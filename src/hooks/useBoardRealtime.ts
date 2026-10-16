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
          qc.invalidateQueries({ queryKey: ["order_tasks_board"] });
          qc.invalidateQueries({ queryKey: ["available_tasks"] });
          qc.invalidateQueries({ queryKey: ["my_work_tasks"] });
          qc.invalidateQueries({ queryKey: ["orders_progress"] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);
}
