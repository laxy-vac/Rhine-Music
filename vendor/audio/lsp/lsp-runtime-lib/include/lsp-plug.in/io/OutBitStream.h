/*
 * Copyright (C) 2025 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2025 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 3 мар. 2021 г.
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

#ifndef LSP_PLUG_IN_IO_OUTBITSTREAM_H_
#define LSP_PLUG_IN_IO_OUTBITSTREAM_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/runtime/LSPString.h>
#include <lsp-plug.in/io/IOutStream.h>
#include <lsp-plug.in/io/Path.h>
#include <lsp-plug.in/io/File.h>

namespace lsp
{
    namespace io
    {
        /**
         * Output bit stream
         */
        class OutBitStream: public IOutStream
        {
            private:
                IOutStream     *pOS;            // Output stream for writing
                size_t          nWrapFlags;     // Wrapping flags
                umword_t        nBuffer;        // Fixed-size buffer
                size_t          nBits;          // Number of bits stored

            public:
                explicit OutBitStream();
                OutBitStream(const OutBitStream &) = delete;
                OutBitStream(OutBitStream &&) = delete;
                virtual ~OutBitStream() override;

                OutBitStream & operator = (const OutBitStream &) = delete;
                OutBitStream & operator = (OutBitStream &&) = delete;

            protected:
                status_t            do_flush_buffer();

            public:
                status_t            open(const char *path, size_t mode);
                status_t            open(const LSPString *path, size_t mode);
                status_t            open(const io::Path *path, size_t mode);

                status_t            wrap(FILE *fd, bool close);
                status_t            wrap_native(fhandle_t fd, bool close);
                status_t            wrap(File *fd, size_t flags = 0);
                status_t            wrap(IOutStream *os, size_t flags = 0);

            public:
                virtual ssize_t     bwrite(const void *buf, size_t bits);

            public:
                virtual ssize_t     write(const void *buf, size_t count) override;

                virtual status_t    flush() override;
                virtual status_t    close() override;

            public:

                status_t            bwrite(bool value);
                inline status_t     writev(bool value)                                          { return bwrite(value);                }
                inline status_t     writev(uint8_t value, size_t bits = sizeof(uint8_t)*8)      { return writev(uint32_t(value), bits);  }
                inline status_t     writev(int8_t value, size_t bits = sizeof(int8_t)*8)        { return writev(uint32_t(value), bits);  }
                inline status_t     writev(uint16_t value, size_t bits = sizeof(uint16_t)*8)    { return writev(uint32_t(value), bits);  }
                inline status_t     writev(int16_t value, size_t bits = sizeof(int16_t)*8)      { return writev(uint32_t(value), bits);  }

                status_t            writev(uint32_t value, size_t bits = sizeof(uint32_t)*8);
                inline status_t     writev(int32_t value, size_t bits = sizeof(int32_t)*8)      { return writev(uint32_t(value), bits);  }
                status_t            writev(uint64_t value, size_t bits = sizeof(uint64_t)*8);
                inline status_t     writev(int64_t value, size_t bits = sizeof(int64_t)*8)      { return writev(uint64_t(value), bits);  }
        };

    } /* namespace io */
} /* namespace lsp */

#endif /* LSP_PLUG_IN_IO_OUTBITSTREAM_H_ */
