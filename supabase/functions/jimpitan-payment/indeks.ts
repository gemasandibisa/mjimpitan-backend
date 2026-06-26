import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apiKey, content-type',
}

serve(async (req) => {
  // Mengatasi keamanan CORS Browser
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const url = new URL(req.url)
  const action = url.searchParams.get('action')
  
  // Mengambil kunci rahasia dari sistem Cloud Supabase
  const midtransServerKey = Deno.env.get('MIDTRANS_SERVER_KEY') || ''
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

  const b64Key = btoa(midtransServerKey + ':')

  try {
    // === FITUR A: MEMBUAT TOKEN TRANSAKSI (AKSI: create-token) ===
    if (action === 'create-token' && req.method === 'POST') {
      const body = await req.json()
      const { nama_petugas, email, password, pin, amount } = body

      const orderId = 'JMP-' + Date.now()
      
      // Trik enkapsulasi data pendaftaran ke teks string pendek
      const customerData = JSON.stringify({ 
        nama: nama_petugas, email: email, pass: password, pin: pin 
      })

      // Tembak langsung ke API Midtrans
      const response = await fetch('https://app.sandbox.midtrans.com/snap/v1/transactions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Basic ${b64Key}`
        },
        body: JSON.stringify({
          transaction_details: { order_id: orderId, gross_amount: amount },
          custom_field1: customerData, // Titip data pendaftaran di sini
          customer_details: { first_name: nama_petugas, email: email }
        })
      })

      const data = await response.json()
      return new Response(JSON.stringify({ snapToken: data.token }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      })
    }

    // === FITUR B: WEBHOOK OTOMATIS SAAT LUNAS (AKSI: webhook) ===
    if (action === 'webhook' && req.method === 'POST') {
      const notification = await req.json()
      
      const transactionStatus = notification.transaction_status
      const fraudStatus = notification.fraud_status
      const customField1 = notification.custom_field1

      // Jika pembayaran sukses terkonfirmasi
      if (transactionStatus === 'settlement' && fraudStatus === 'accept' && customField1) {
        const userData = JSON.parse(customField1)

        // Hubungkan ke Database menggunakan library internal Supabase resmi
        const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2")
        const supabase = createClient(supabaseUrl, supabaseServiceKey)

        // Masukkan data otomatis ke tabel 'users' Anda
        const { error } = await supabase
          .from('users')
          .insert([
            {
              email: userData.email,
              password: userData.pass,
              nama_petugas: userData.nama,
              pin: String(userData.pin),
              role: 'officer',
              tenant_id: 'tenant_' + Date.now()
            }
          ])

        if (error) {
          console.error("Gagal Input Database:", error.message)
          return new Response("DB Error", { status: 500 })
        }
        console.log(`Akun ${userData.email} berhasil diaktivasi secara otomatis!`)
      }

      return new Response('OK', { status: 200 })
    }

    return new Response('Aksi tidak ditemukan', { status: 404 })

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500
    })
  }
})

