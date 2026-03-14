import mongoose from "mongoose";;
import dotenv from "dotenv";

dotenv.config();

export const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);

        console.log("DB CONNECTED");
    } catch (error) {
        console.log("Database connection failed:", error);
    }
}
