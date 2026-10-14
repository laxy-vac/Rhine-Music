/*
 * Copyright (C) 2023 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2023 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 18 июн. 2018 г.
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

#ifndef LSP_PLUG_IN_IO_OUTSEQUENCE_H_
#define LSP_PLUG_IN_IO_OUTSEQUENCE_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/common/types.h>
#include <lsp-plug.in/io/charset.h>
#include <lsp-plug.in/io/Path.h>
#include <lsp-plug.in/io/File.h>
#include <lsp-plug.in/io/CharsetEncoder.h>
#include <lsp-plug.in/io/IOutStream.h>
#include <lsp-plug.in/io/IOutSequence.h>
#include <lsp-plug.in/stdlib/stdio.h>

namespace lsp
{
    namespace io
    {
        class OutSequence: public IOutSequence
        {
            protected:
                IOutStream     *pOS;
                size_t          nWrapFlags;
                CharsetEncoder  sEncoder;
    
            protected:
                status_t        flush_buffer_internal(bool force);

            public:
                explicit OutSequence();
                OutSequence(const OutSequence &) = delete;
                OutSequence(OutSequence &&) = delete;
                virtual ~OutSequence() override;

                OutSequence & operator = (const OutSequence &) = delete;
                OutSequence & operator = (OutSequence &&) = delete;

            public:
                using IOutSequence::write;
                using IOutSequence::write_ascii;

            public:
                status_t wrap(FILE *fd, bool close, const char *charset = NULL);

                status_t wrap_native(fhandle_t fd, bool close, const char *charset = NULL);

                status_t wrap(File *fd, size_t flags, const char *charset = NULL);

                status_t wrap(IOutStream *os, size_t flags, const char *charset = NULL);

                status_t open(const char *path, size_t mode, const char *charset = NULL);

                status_t open(const LSPString *path, size_t mode, const char *charset = NULL);

                status_t open(const Path *path, size_t mode, const char *charset = NULL);

            public:
                virtual status_t write(lsp_wchar_t c) override;
                virtual status_t write(const lsp_wchar_t *c, size_t count) override;
                virtual status_t write_ascii(const char *s, size_t count) override;
                virtual status_t flush() override;
                virtual status_t close() override;
        };

    } /* namespace io */
} /* namespace lsp */

#endif /* LSP_PLUG_IN_IO_OUTSEQUENCE_H_ */
