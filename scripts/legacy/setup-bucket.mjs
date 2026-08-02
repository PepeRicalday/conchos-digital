import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function main() {
    console.log("Creando bucket...");
    const { data: bucket, error: bucketError } = await supabase.storage.createBucket("hydric-knowledge", {
        public: false,
        fileSizeLimit: 104857600, // 100MB
    });

    if (bucketError) {
        console.error("Error creando bucket:", bucketError.message);
    } else {
        console.log("Bucket creado exitosamente:", bucket);
    }

    // List buckets just to confirm
    const { data: buckets } = await supabase.storage.listBuckets();
    console.log("Buckets actuales:", buckets?.map(b => b.name));
}

main().catch(console.error);
