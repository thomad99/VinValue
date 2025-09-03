# VIN Value GPT Integration

## API Endpoint
**URL**: `https://your-render-app.onrender.com/api/gpt-value`  
**Method**: `POST`  
**Content-Type**: `application/json`

## Request Format

### Option 1: VIN Lookup
```json
{
  "vin": "1HGBH41JXMN109186",
  "mileage": 50000,
  "zip": "34238",
  "email": "user@example.com"
}
```

### Option 2: Make & Model Lookup
```json
{
  "make": "Honda",
  "model": "Civic",
  "year": "2020",
  "mileage": 50000,
  "zip": "34238",
  "email": "user@example.com"
}
```

## Required Fields
- **Either**: `vin` OR (`make` + `model` + `year`)
- **Always**: `mileage` (in miles)
- **Optional**: `zip`, `email` (will use server defaults if not provided)

## Response Format

### Success
```json
{
  "success": true,
  "valuation": 15000,
  "method": "VIN Lookup",
  "selections": ["Sedan", "Automatic"],
  "message": "Car valued at $15000 using VIN Lookup method"
}
```

### Error
```json
{
  "error": "Valuation failed",
  "message": "Could not find VIN input field",
  "details": "Check the web interface for detailed debugging information"
}
```

## GPT Instructions

1. **Ask user for car details**:
   - "Do you have the VIN number, or should I use Make/Model/Year?"
   - "What's the current mileage?"

2. **Make API call** to `/api/gpt-value` with the collected data

3. **Present results**:
   - Show the valuation amount prominently
   - Mention the method used (VIN vs Make/Model)
   - List any vehicle selections made by the system

## Example GPT Conversation Flow

**User**: "I want to value my 2020 Honda Civic with 50,000 miles"

**GPT**: "I'll get a valuation for your 2020 Honda Civic. Let me check the current market value..."

**API Call**: 
```json
{
  "make": "Honda",
  "model": "Civic", 
  "year": "2020",
  "mileage": 50000
}
```

**GPT Response**: "Your 2020 Honda Civic with 50,000 miles is valued at **$15,000** using Make & Model lookup. The system automatically selected 'Sedan' and 'Automatic' as the vehicle specifications."
