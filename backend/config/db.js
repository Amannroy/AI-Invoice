import mongoose, { mongo } from "mongoose";


export const connectDB = async () => {
    await mongoose.connect('mongodb+srv://royaman56456_db_user:invoice123@cluster0.ppeocns.mongodb.net/InvoiceAI') 
    .then(() => {console.log("DB CONNECTED");
    })
}
