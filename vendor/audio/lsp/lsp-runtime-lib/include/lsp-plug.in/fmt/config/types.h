/*
 * Copyright (C) 2026 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2026 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 29 апр. 2020 г.
 *
 * lsp-runtime-lib is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * any later version.
 *
 * lsp-runtime-lib is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with lsp-runtime-lib. If not, see <https://www.gnu.org/licenses/>.
 */

#ifndef LSP_PLUG_IN_FMT_CONFIG_TYPES_H_
#define LSP_PLUG_IN_FMT_CONFIG_TYPES_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/runtime/LSPString.h>

namespace lsp
{
    namespace config
    {
        enum serial_flags_t
        {
            SF_NONE         = 0,        //!< SF_NONE no flags

            SF_TYPE_NONE    = 0,
            SF_TYPE_I32     = 0x01,     //!< SF_TYPE_I32 Parameter is of int32 type
            SF_TYPE_U32     = 0x02,     //!< SF_TYPE_U32 Parameter is of uint32 type
            SF_TYPE_I64     = 0x03,     //!< SF_TYPE_I64 Parameter is of int64 type
            SF_TYPE_U64     = 0x04,     //!< SF_TYPE_U64 Parameter is of uint64 type
            SF_TYPE_F32     = 0x05,     //!< SF_TYPE_F32 Parameter is of float type
            SF_TYPE_F64     = 0x06,     //!< SF_TYPE_F64 Parameter is of double type
            SF_TYPE_BOOL    = 0x07,     //!< SF_TYPE_BOOL Parameter is of boolean type
            SF_TYPE_STR     = 0x08,     //!< SF_TYPE_STR Parameter is of string type
            SF_TYPE_BLOB    = 0x09,     //!< SF_TYPE_BLOB Parameter is of blob type

            SF_TYPE_MASK    = 0x0f,     //!< SF_TYPE_MASK Data type mask

            SF_PREC_NORMAL  = 0x00,     //!< SF_PREC_NORMAL Normal precision
            SF_PREC_SHORT   = 0x10,     //!< SF_PREC_SHORT Short precision
            SF_PREC_LONG    = 0x20,     //!< SF_PREC_SHORT Long precision
            SF_PREC_SCI     = 0x30,     //!< SF_PREC_SCI Scientific presentation
            SF_PREC_MASK    = 0x30,     //!< SF_PREC_MASK Precision mask for floating-point values

            SF_QUOTED       = 1 << 8,   //!< SF_QUOTED Parameter is quoted
            SF_COMMENT      = 1 << 9,   //!< SF_COMMENT Parameter has comment
            SF_TYPE_SET     = 1 << 10,  //!< SF_TYPE_SET Explicitly specify type
            SF_DECIBELS     = 1 << 11,  //!< SF_DECIBELS Serialize value as decibels
            SF_FRIENDLY     = 1 << 12,  //!< SF_FRIENDLY User-friendly values
        };

        /**
         * Blob data
         */
        typedef struct blob_t
        {
            size_t      length;         // Length of the BLOB
            char       *ctype;          // Content-type UTF-8 encoded
            char       *data;           // BLOB data present as UTF-8 string by default
        } blob_t;

        typedef union
        {
            int32_t         i32;
            uint32_t        u32;
            int64_t         i64;
            uint64_t        u64;
            float           f32;
            double          f64;
            bool            bval;   // Boolean value
            char           *str;    // UTF-8 string value (for string)
            blob_t          blob;   // BLOB data
        } value_t;

        /**
         * Parameters stored in the configuration file
         */
        typedef struct param_t
        {
            public:
                LSPString   name;           // Name of parameter
                LSPString   comment;        // Comment
                size_t      flags;          // Serialization flags
                value_t     v;              // Value

            protected:
                void        drop_value();

            public:
                explicit param_t();
                param_t(const param_t &) = delete;
                param_t(param_t &&) = delete;
                ~param_t();

                param_t &operator = (const param_t &) = delete;
                param_t &operator = (param_t &&) = delete;

            public:
                bool            copy(const param_t *src);
                inline bool     copy(const param_t &src)    { return copy(&src); };

                void            swap(param_t *dst);
                inline void     swap(param_t &dst)          { swap(&dst); };

                void            clear();
                void            clear_value();

            public:
                // Type checking methods
                inline size_t   type() const                { return flags & SF_TYPE_MASK;                      }
                inline bool     is_i32() const              { return (flags & SF_TYPE_MASK) == SF_TYPE_I32;     }
                inline bool     is_u32() const              { return (flags & SF_TYPE_MASK) == SF_TYPE_U32;     }
                inline bool     is_i64() const              { return (flags & SF_TYPE_MASK) == SF_TYPE_I64;     }
                inline bool     is_u64() const              { return (flags & SF_TYPE_MASK) == SF_TYPE_U64;     }
                inline bool     is_f32() const              { return (flags & SF_TYPE_MASK) == SF_TYPE_F32;     }
                inline bool     is_f64() const              { return (flags & SF_TYPE_MASK) == SF_TYPE_F64;     }
                inline bool     is_bool() const             { return (flags & SF_TYPE_MASK) == SF_TYPE_BOOL;    }
                inline bool     is_str() const              { return (flags & SF_TYPE_MASK) == SF_TYPE_STR;     }
                inline bool     is_string() const           { return (flags & SF_TYPE_MASK) == SF_TYPE_STR;     }
                inline bool     is_blob() const             { return (flags & SF_TYPE_MASK) == SF_TYPE_BLOB;    }

                bool            is_int() const;
                bool            is_signed() const;
                bool            is_unsigned() const;
                bool            is_float() const;
                bool            is_numeric() const;
                bool            is_simple() const;

                // Direct type-checked reading
                inline int32_t          get_i32() const     { return (is_i32()) ? v.i32 : 0;                    }
                inline uint32_t         get_u32() const     { return (is_u32()) ? v.u32 : 0;                    }
                inline int64_t          get_i64() const     { return (is_i64()) ? v.i64 : 0;                    }
                inline uint64_t         get_u64() const     { return (is_u64()) ? v.u64 : 0;                    }
                inline float            get_f32() const     { return (is_f32()) ? v.f32 : 0.0f;                 }
                inline double           get_f64() const     { return (is_f64()) ? v.f64 : 0.0;                  }
                inline float            get_float() const   { return get_f32();                                 }
                inline double           get_double() const  { return get_f64();                                 }
                inline bool             get_bool() const    { return (is_bool()) ? v.bval : false;              }
                inline const char      *get_string() const  { return (is_str()) ? v.str : NULL;                 }
                inline const blob_t    *get_blob() const    { return (is_blob()) ? &v.blob : NULL;              }

                // Precision check
                inline bool     is_prec_normal() const      { return (flags & SF_PREC_MASK) == SF_PREC_NORMAL;  }
                inline bool     is_prec_short() const       { return (flags & SF_PREC_MASK) == SF_PREC_SHORT;   }
                inline bool     is_prec_long() const        { return (flags & SF_PREC_MASK) == SF_PREC_LONG;    }
                inline bool     is_prec_sci() const         { return (flags & SF_PREC_MASK) == SF_PREC_SCI;     }

                // Miscellaneous checks
                inline bool     is_quoted() const           { return (flags & SF_QUOTED);                       }
                inline bool     is_type_set() const         { return (flags & SF_TYPE_SET);                     }
                inline bool     has_comment() const         { return (flags & SF_COMMENT);                      }
                inline bool     is_decibel() const          { return (flags & SF_DECIBELS);                     }

                // Type conversion
                int32_t         to_i32() const;
                uint32_t        to_u32() const;
                int64_t         to_i64() const;
                uint64_t        to_u64() const;
                ssize_t         to_int() const;
                size_t          to_uint() const;
                float           to_f32() const;
                double          to_f64() const;
                inline float    to_float() const            { return to_f32();                                  }
                inline double   to_double() const           { return to_f64();                                  }
                bool            to_bool() const;

                // Updates
                void            set_i32(int32_t value);
                void            set_u32(uint32_t value);
                void            set_i64(int64_t value);
                void            set_u64(uint64_t value);
                void            set_f32(float value);
                void            set_f64(double value);
                inline void     set_float(float value)      { set_f32(value); }
                inline void     set_doublet(double value)   { set_f64(value); }
                void            set_bool(bool value);
                bool            set_string(const char *value);
                bool            set_string(const LSPString * value);
                bool            set_string(const LSPString & value);
                bool            set_blob(const blob_t *value);
                bool            set_blob(size_t length, const char *ctype, const char *data);

                bool            set_name(const char * name);
                bool            set_name(const LSPString * name);
                bool            set_name(const LSPString & name);
        } param_t;

    } /* namespace config */
} /* namespace lsp */

#endif /* LSP_PLUG_IN_FMT_CONFIG_TYPES_H_ */
