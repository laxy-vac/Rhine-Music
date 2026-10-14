/*
 * Copyright (C) 2021 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2021 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 14 мар. 2021 г.
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

#ifndef LSP_PLUG_IN_IO_INBITSTREAM_H_
#define LSP_PLUG_IN_IO_INBITSTREAM_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/runtime/LSPString.h>
#include <lsp-plug.in/io/IInStream.h>
#include <lsp-plug.in/io/Path.h>
#include <lsp-plug.in/io/File.h>

namespace lsp
{
    namespace io
    {
        class InBitStream: public IInStream
        {
            protected:
                IInStream      *pIS;            // Input stream
                size_t          nWrapFlags;     // Wrap flags
                umword_t        nBuffer;        // Fixed-size buffer
                size_t          nBits;          // Number of bits stored

            protected:
                status_t        fill();
                void            unread(umword_t v, size_t bits);
                status_t        do_close();

            public:
                explicit InBitStream();
                InBitStream(const InBitStream &) = delete;
                InBitStream(InBitStream &&) = delete;
                virtual ~InBitStream() override;

                InBitStream & operator = (const InBitStream &) = delete;
                InBitStream & operator = (InBitStream &&) = delete;

            public:
                /** Wrap stdio file descriptor. The Reader should be in closed state.
                 *
                 * @param fd file descriptor
                 * @param close close file descriptor on close()
                 * @return status of operation
                 */
                status_t wrap(FILE *fd, bool close);

                /** Wrap native file descriptor. The Reader should be in closed state.
                 *
                 * @param fd file descriptor
                 * @param close close file descriptor on close()
                 * @return status of operation
                 */
                status_t wrap_native(fhandle_t fd, bool close);

                /** Wrap file descriptor. The Reader should be in closed state.
                 *
                 * @param fd file descriptor
                 * @param flags wrapping flags
                 * @return status of operation
                 */
                status_t wrap(File *fd, size_t flags);

                /** Wrap output stream
                 *
                 * @param is input stream
                 * @param flags wrapping flags
                 * @return status of operation
                 */
                status_t wrap(IInStream *is, size_t flags = 0);

                /** Open input stream associated with file. The Reader should be in closed state.
                 *
                 * @param path file location path
                 * @return status of operation
                 */
                status_t open(const char *path);

                /** Open input stream associated with file. The Reader should be in closed state.
                 *
                 * @param path file location path
                 * @return status of operation
                 */
                status_t open(const LSPString *path);

                /** Open input stream associated with file. Before open currently open stream is closed and it's
                 * state is reset.
                 *
                 * @param path file location path
                 * @return status of operation
                 */
                status_t open(const Path *path);

            public:
                virtual ssize_t     read(void *dst, size_t count) override;
                ssize_t             bread(void *buf, size_t bits);

                virtual wssize_t    bskip(wsize_t amount);

                virtual status_t    close() override;

            public:
                ssize_t             readb(bool *value);
                ssize_t             readv(bool *value)                                          { return readb(value);                      }
                ssize_t             readv(uint8_t *value, size_t bits = sizeof(uint8_t)*8);
                inline ssize_t      readv(int8_t *value, size_t bits = sizeof(int8_t)*8)        { return readv(reinterpret_cast<uint8_t *>(value), bits);       }
                ssize_t             readv(uint16_t *value, size_t bits = sizeof(uint16_t)*8);
                inline ssize_t      readv(int16_t *value, size_t bits = sizeof(int16_t)*8)      { return readv(reinterpret_cast<uint16_t *>(value), bits);      }

                ssize_t             readv(uint32_t *value, size_t bits = sizeof(uint32_t)*8);
                inline ssize_t      readv(int32_t *value, size_t bits = sizeof(int32_t)*8)      { return readv(reinterpret_cast<uint32_t *>(value), bits);      }
                ssize_t             readv(uint64_t *value, size_t bits = sizeof(uint64_t)*8);
                inline ssize_t      readv(int64_t *value, size_t bits = sizeof(int64_t)*8)      { return readv(reinterpret_cast<uint64_t *>(value), bits);      }
        };

    } /* namespace io */
} /* namespace lsp */


#endif /* LSP_PLUG_IN_IO_INBITSTREAM_H_ */
